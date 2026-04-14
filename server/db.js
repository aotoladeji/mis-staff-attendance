import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('[db] FATAL: DATABASE_URL environment variable is not set.');
}

// Aiven (and similar hosted PG services) require explicit SSL options in Node.js.
// The ?sslmode=require param in the URL is not enough — pg needs the ssl object too.
const sslRequired =
  process.env.DATABASE_URL?.includes('sslmode=require') ||
  process.env.DATABASE_URL?.includes('aivencloud') ||
  process.env.DATABASE_URL?.includes('.aiven.io');

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(sslRequired ? { ssl: { rejectUnauthorized: false } } : {}),
  // Serverless-friendly: release idle connections quickly
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
  max: 3,
});

/**
 * Create tables if they don't already exist.
 * Called once on server startup.
 */
export const initDB = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff (
      id               SERIAL PRIMARY KEY,
      name             VARCHAR(255)  NOT NULL,
      position         VARCHAR(255)  NOT NULL,
      employee_code    VARCHAR(100),
      department       VARCHAR(255),
      email            VARCHAR(255),
      phone            VARCHAR(100),
      status           VARCHAR(50)   NOT NULL DEFAULT 'active',
      notes            TEXT,
      photo            TEXT,
      pending_query_note TEXT,
      pending_query_updated_at TIMESTAMPTZ,
      created_at       TIMESTAMPTZ   DEFAULT NOW()
    );

    ALTER TABLE staff
      ADD COLUMN IF NOT EXISTS pending_query_note TEXT;

    ALTER TABLE staff
      ADD COLUMN IF NOT EXISTS pending_query_updated_at TIMESTAMPTZ;

    ALTER TABLE staff
      ADD COLUMN IF NOT EXISTS employee_code VARCHAR(100);

    ALTER TABLE staff
      ADD COLUMN IF NOT EXISTS department VARCHAR(255);

    ALTER TABLE staff
      ADD COLUMN IF NOT EXISTS email VARCHAR(255);

    ALTER TABLE staff
      ADD COLUMN IF NOT EXISTS phone VARCHAR(100);

    ALTER TABLE staff
      ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'active';

    ALTER TABLE staff
      ADD COLUMN IF NOT EXISTS notes TEXT;

    ALTER TABLE staff
      ADD COLUMN IF NOT EXISTS card_uid VARCHAR(100);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_card_uid
      ON staff(card_uid) WHERE card_uid IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_staff_employee_code
      ON staff(employee_code);

    CREATE INDEX IF NOT EXISTS idx_staff_email
      ON staff(email);

    CREATE TABLE IF NOT EXISTS fingerprints (
      id          SERIAL PRIMARY KEY,
      staff_id    INTEGER REFERENCES staff(id) ON DELETE CASCADE,
      finger      VARCHAR(20)  NOT NULL,
      image_data  TEXT         NOT NULL,
      created_at  TIMESTAMPTZ  DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_fingerprints_staff_id
      ON fingerprints(staff_id);

    CREATE TABLE IF NOT EXISTS attendance_logs (
      id         SERIAL PRIMARY KEY,
      staff_id   INTEGER REFERENCES staff(id) ON DELETE SET NULL,
      type       VARCHAR(10)  NOT NULL CHECK (type IN ('in', 'out')),
      timestamp  TIMESTAMPTZ  DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_attendance_staff_id
      ON attendance_logs(staff_id);

    CREATE INDEX IF NOT EXISTS idx_attendance_timestamp
      ON attendance_logs(timestamp DESC);

    CREATE TABLE IF NOT EXISTS attendance_settings (
      id              INTEGER PRIMARY KEY DEFAULT 1,
      shift_start     VARCHAR(5)  NOT NULL DEFAULT '08:00',
      shift_end       VARCHAR(5)  NOT NULL DEFAULT '17:00',
      late_grace_min  INTEGER     NOT NULL DEFAULT 0,
      overtime_min    INTEGER     NOT NULL DEFAULT 0
    );

    INSERT INTO attendance_settings (id, shift_start, shift_end, late_grace_min, overtime_min)
    VALUES (1, '08:00', '17:00', 0, 0)
    ON CONFLICT (id) DO NOTHING;
  `);

  console.log('Database schema ready.');
};
