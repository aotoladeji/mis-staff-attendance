/**
 * Express app setup — shared by the local dev server (server/index.js)
 * and the Vercel serverless entry point (api/index.js).
 * Does NOT call app.listen() or initDB() — those are the caller's responsibility.
 */
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import staffRouter from './routes/staff.js';
import attendanceRouter from './routes/attendance.js';
import settingsRouter from './routes/settings.js';
import mobileRouter from './routes/mobile.js';

// Load .env for local dev. On Vercel, env vars are injected directly — this is a no-op.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const ZK_HOST = process.env.ZK_SDK_HOST || 'localhost';
const ZK_PORT = parseInt(process.env.ZK_SDK_PORT || '28815', 10);

/**
 * Send a POST to the ZK SDK over a raw TCP socket.
 * This only works when the ZK SDK Windows service is running locally.
 * On Vercel it will throw, and the route already returns 503 on error.
 */
const zkPost = (body) =>
  new Promise((resolve, reject) => {
    const postData = Buffer.from(body);
    const requestHead = [
      `POST / HTTP/1.0`,
      `Host: ${ZK_HOST}:${ZK_PORT}`,
      `Content-Type: application/x-www-form-urlencoded`,
      `Content-Length: ${postData.length}`,
      `Connection: close`,
      ``,
      ``,
    ].join('\r\n');

    const chunks = [];
    const socket = new net.Socket();
    socket.setTimeout(60_000);

    socket.connect(ZK_PORT, ZK_HOST, () => {
      socket.write(requestHead);
      socket.write(postData);
    });

    socket.on('data', (chunk) => chunks.push(chunk));

    socket.on('end', () => {
      const full = Buffer.concat(chunks).toString('utf8');
      const crlfIdx = full.indexOf('\r\n\r\n');
      const lfIdx   = full.indexOf('\n\n');
      let bodyStart = 0;
      if (crlfIdx >= 0) bodyStart = crlfIdx + 4;
      else if (lfIdx >= 0) bodyStart = lfIdx + 2;
      resolve(full.slice(bodyStart).trim());
    });

    socket.on('timeout', () =>
      socket.destroy(new Error('ZK SDK request timed out after 60 s'))
    );
    socket.on('error', reject);
  });

const app = express();

app.use(cors());
app.use(express.json({ limit: '20mb' }));

app.use('/api/staff', staffRouter);
app.use('/api/attendance', attendanceRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/mobile', mobileRouter);

/**
 * Proxy fingerprint capture to the local ZK SDK Windows service.
 * Returns 503 when the service is unreachable (normal on Vercel/cloud).
 */
app.post('/api/fingerprint/capture', async (req, res) => {
  const encoded = Buffer.from(JSON.stringify({ action: '14' })).toString('base64');

  let raw;
  try {
    raw = await zkPost(encoded);
  } catch (err) {
    console.error('[ZK] Network error:', err.message);
    return res.status(503).json({
      error: `Cannot reach fingerprint scanner service: ${err.message}. Is the ZK SDK Windows service running?`,
    });
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return res.status(502).json({ error: `Fingerprint service returned unexpected data: ${raw.slice(0, 80)}` });
  }

  if (data.result === '02') {
    return res.status(503).json({ error: 'Fingerprint device not ready — try unplugging and reconnecting it.' });
  }
  if (!data.FigPicBase64) {
    return res.status(422).json({
      error: 'No fingerprint data received. Place your finger firmly on the scanner and try again.',
    });
  }

  res.json({ template: data.FigPicBase64 });
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

export default app;
