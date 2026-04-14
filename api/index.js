/**
 * Vercel serverless entry point.
 * Wraps the Express app so all /api/* requests are handled by a single function.
 * The Express app handles its own routing internally.
 */
import app from '../server/app.js';
import { initDB } from '../server/db.js';

// Module-level flag so initDB only runs once per warm serverless instance.
let dbReady = false;
let dbError = null;
let dbInitPromise = null;

const ensureDB = () => {
  if (!dbReady && !dbInitPromise) {
    dbInitPromise = initDB()
      .then(() => { dbReady = true; dbError = null; })
      .catch((err) => {
        dbError = err;
        console.error('[db] initDB failed:', err.message);
        // Reset so the next cold-start can retry
        dbInitPromise = null;
      });
  }
  return dbInitPromise;
};

// Pre-warm the DB connection on cold start.
ensureDB();

export default async (req, res) => {
  await ensureDB().catch(() => {});

  // If DB still not ready, surface a clear error instead of a confusing 500
  if (!dbReady && dbError) {
    const safe = dbError.message?.replace(/password=[^\s@]*/gi, 'password=***');
    return res.status(503).json({
      error: 'Database unavailable',
      detail: safe,
      hint: 'Check that DATABASE_URL is set in Vercel Environment Variables.',
    });
  }

  return app(req, res);
};
