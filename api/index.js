/**
 * Vercel serverless entry point.
 * Wraps the Express app so all /api/* requests are handled by a single function.
 * The Express app handles its own routing internally.
 */
import app from '../server/app.js';
import { initDB } from '../server/db.js';

// Module-level flag so initDB only runs once per warm serverless instance.
let dbReady = false;
let dbInitPromise = null;

const ensureDB = () => {
  if (!dbReady && !dbInitPromise) {
    dbInitPromise = initDB()
      .then(() => { dbReady = true; })
      .catch(console.error);
  }
  return dbInitPromise;
};

// Pre-warm the DB connection on cold start.
ensureDB();

export default async (req, res) => {
  await ensureDB();
  return app(req, res);
};
