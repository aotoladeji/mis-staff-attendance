import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDB } from './db.js';
import staffRouter from './routes/staff.js';
import attendanceRouter from './routes/attendance.js';
import settingsRouter from './routes/settings.js';
import mobileRouter from './routes/mobile.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();

// Parse ZK SDK host/port from env (default localhost:28815)
const ZK_HOST = process.env.ZK_SDK_HOST || 'localhost';
const ZK_PORT = parseInt(process.env.ZK_SDK_PORT || '28815', 10);

/**
 * Send a POST to the ZK SDK over a raw TCP socket, completely bypassing
 * Node's HTTP parser (llhttp). The ZK SDK uses non-standard HTTP line endings
 * in its response (bare \n instead of \r\n) which cause llhttp to throw
 * "Parse Error: Missing expected LF after header value".
 * Reading raw bytes and extracting the JSON body ourselves avoids that entirely.
 */
const zkPost = (body) =>
  new Promise((resolve, reject) => {
    const postData = Buffer.from(body);
    // Use HTTP/1.0 + Connection: close so the server closes the socket when done
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
      // Extract body — everything after the first blank line (\r\n\r\n or \n\n)
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

app.use(cors());
app.use(express.json({ limit: '20mb' }));

app.use('/api/staff', staffRouter);
app.use('/api/attendance', attendanceRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/mobile', mobileRouter);

/**
 * Proxy fingerprint capture to the ZK SDK Windows service.
 * The browser can't call localhost:28815 directly (CORS), so we forward it here.
 * The ZK SDK demo (SignDemo.html) sends a base64-encoded JSON string as the body.
 * We allow 60 s for the user to press their finger.
 */
app.post('/api/fingerprint/capture', async (req, res) => {
  // base64 of '{"action":"14"}' — matches what the SDK demo does with codeHandler.encode
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

  console.log('[ZK] Raw response:', raw.slice(0, 300));

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error('[ZK] Non-JSON response:', raw.slice(0, 300));
    return res.status(502).json({ error: `Fingerprint service returned unexpected data: ${raw.slice(0, 80)}` });
  }

  if (data.result === '02') {
    return res.status(503).json({ error: 'Fingerprint device not ready — try unplugging and reconnecting it.' });
  }
  if (!data.FigPicBase64) {
    console.error('[ZK] Missing FigPicBase64 in response:', JSON.stringify(data));
    return res.status(422).json({
      error: 'No fingerprint data received. Place your finger firmly on the scanner and try again.',
    });
  }

  res.json({ template: data.FigPicBase64 });
});

// Health check
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

const PORT = process.env.SERVER_PORT || 5001;

initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`ITeMS || Staff Attendance API running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialise database:', err.message);
    process.exit(1);
  });
