import { Router } from 'express';
import { pool } from '../db.js';
import { findBestMatch } from '../utils/fingerprintMatch.js';

const router = Router();

const normalizeText = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const normalizeStaffPayload = (payload = {}) => ({
  name: normalizeText(payload.name),
  position: normalizeText(payload.position),
  employee_code: normalizeText(payload.employee_code),
  department: normalizeText(payload.department),
  email: normalizeText(payload.email)?.toLowerCase() ?? null,
  phone: normalizeText(payload.phone),
  status: normalizeText(payload.status) ?? 'active',
  notes: normalizeText(payload.notes),
  photo: normalizeText(payload.photo),
  card_uid: normalizeText(payload.card_uid),
});

const staffSelect = `
  SELECT
    s.id,
    s.name,
    s.position,
    s.employee_code,
    s.department,
    s.email,
    s.phone,
    s.status,
    s.notes,
    s.photo,
    s.card_uid,
    s.created_at,
    s.pending_query_note,
    s.pending_query_updated_at,
    COUNT(f.id)::int AS fingerprint_count
  FROM staff s
  LEFT JOIN fingerprints f ON f.staff_id = s.id
`;

const groupAndOrderStaff = `
  GROUP BY s.id
  ORDER BY s.name
`;

const findExistingStaff = async (client, staff) => {
  if (staff.employee_code) {
    const existing = await client.query(
      'SELECT id FROM staff WHERE employee_code = $1 LIMIT 1',
      [staff.employee_code]
    );
    if (existing.rows[0]) return existing.rows[0];
  }

  if (staff.email) {
    const existing = await client.query(
      'SELECT id FROM staff WHERE LOWER(email) = LOWER($1) LIMIT 1',
      [staff.email]
    );
    if (existing.rows[0]) return existing.rows[0];
  }

  if (staff.phone) {
    const existing = await client.query(
      'SELECT id FROM staff WHERE phone = $1 LIMIT 1',
      [staff.phone]
    );
    if (existing.rows[0]) return existing.rows[0];
  }

  if (staff.name && staff.position) {
    const existing = await client.query(
      'SELECT id FROM staff WHERE LOWER(name) = LOWER($1) AND LOWER(position) = LOWER($2) LIMIT 1',
      [staff.name, staff.position]
    );
    if (existing.rows[0]) return existing.rows[0];
  }

  return null;
};

// GET /api/staff — list all staff (with fingerprint enrollment status)
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`${staffSelect} ${groupAndOrderStaff}`);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch staff' });
  }
});

/**
 * POST /api/staff/verify
 * Body: { image: "<base64 JPEG from ZK device>" }
 * Compares the live fingerprint against every enrolled fingerprint in the DB.
 * Returns matched staff info + last attendance action, or 404 if no match.
 * Must be declared BEFORE /:id to avoid route collision.
 */
router.post('/verify', async (req, res) => {
  const { image } = req.body;
  if (!image) {
    return res.status(400).json({ error: 'No fingerprint image provided' });
  }

  try {
    // Load ALL enrolled fingerprints joined with staff info
    const { rows } = await pool.query(`
      SELECT
        f.id AS fp_id, f.staff_id, f.finger, f.image_data,
        s.name, s.position, s.photo, s.pending_query_note,
        (SELECT type FROM attendance_logs
         WHERE staff_id = s.id
         ORDER BY timestamp DESC LIMIT 1) AS last_action
      FROM fingerprints f
      JOIN staff s ON s.id = f.staff_id
    `);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'No enrolled fingerprints found' });
    }

    const match = await findBestMatch(image, rows);

    if (!match) {
      return res.status(404).json({ error: 'Fingerprint not recognised' });
    }

    res.json({
      id: match.staff_id,
      name: match.name,
      position: match.position,
      photo: match.photo,
      last_action: match.last_action,
      pending_query_note: match.pending_query_note,
      matched_finger: match.finger,
      score: Math.round(match.score * 100),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fingerprint verification failed' });
  }
});

/**
 * POST /api/staff
 * Register a new staff member.
 * Body: { name, position, employee_code?, department?, email?, phone?, status?, notes?, photo?, fingerprints? }
 */
router.post('/', async (req, res) => {
  const staff = normalizeStaffPayload(req.body);
  const fingerprints = Array.isArray(req.body?.fingerprints) ? req.body.fingerprints : [];

  if (!staff.name || !staff.position) {
    return res.status(400).json({ error: 'Name and position are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: staffRows } = await client.query(
      `INSERT INTO staff (name, position, employee_code, department, email, phone, status, notes, photo, card_uid)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, name, position, employee_code, department, email, phone, status, notes, photo, card_uid, created_at`,
      [
        staff.name,
        staff.position,
        staff.employee_code,
        staff.department,
        staff.email,
        staff.phone,
        staff.status,
        staff.notes,
        staff.photo,
        staff.card_uid,
      ]
    );
    const staff = staffRows[0];

    for (const fp of fingerprints) {
      if (!fp.finger || !fp.image_data) continue;
      await client.query(
        `INSERT INTO fingerprints (staff_id, finger, image_data) VALUES ($1, $2, $3)`,
        [staff.id, fp.finger, fp.image_data]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ ...staff, fingerprint_count: fingerprints.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to register staff' });
  } finally {
    client.release();
  }
});

// POST /api/staff/bulk-import — create or update staff from spreadsheet rows
router.post('/bulk-import', async (req, res) => {
  const records = Array.isArray(req.body?.staff) ? req.body.staff : [];

  if (records.length === 0) {
    return res.status(400).json({ error: 'At least one staff record is required' });
  }

  const client = await pool.connect();
  let created = 0;
  let updated = 0;

  try {
    await client.query('BEGIN');

    for (const rawRecord of records) {
      const staff = normalizeStaffPayload(rawRecord);
      if (!staff.name || !staff.position) continue;

      const existing = await findExistingStaff(client, staff);

      if (existing) {
        await client.query(
          `UPDATE staff
           SET name = $1,
               position = $2,
               employee_code = $3,
               department = $4,
               email = $5,
               phone = $6,
               status = $7,
               notes = $8,
               photo = COALESCE($9, photo)
           WHERE id = $10`,
          [
            staff.name,
            staff.position,
            staff.employee_code,
            staff.department,
            staff.email,
            staff.phone,
            staff.status,
            staff.notes,
            staff.photo,
            existing.id,
          ]
        );
        updated += 1;
      } else {
        await client.query(
          `INSERT INTO staff (name, position, employee_code, department, email, phone, status, notes, photo)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            staff.name,
            staff.position,
            staff.employee_code,
            staff.department,
            staff.email,
            staff.phone,
            staff.status,
            staff.notes,
            staff.photo,
          ]
        );
        created += 1;
      }
    }

    const { rows } = await client.query(`${staffSelect} ${groupAndOrderStaff}`);
    await client.query('COMMIT');
    res.json({ created, updated, staff: rows });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to import staff records' });
  } finally {
    client.release();
  }
});

// PUT /api/staff/:id — update core staff profile details
router.put('/:id', async (req, res) => {
  const staffId = Number.parseInt(req.params.id, 10);
  const staff = normalizeStaffPayload(req.body);

  if (Number.isNaN(staffId) || staffId <= 0) {
    return res.status(400).json({ error: 'Invalid staff id' });
  }

  if (!staff.name || !staff.position) {
    return res.status(400).json({ error: 'Name and position are required' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE staff
       SET name = $1,
           position = $2,
           employee_code = $3,
           department = $4,
           email = $5,
           phone = $6,
           status = $7,
           notes = $8,
           photo = $9,
           card_uid = $10
       WHERE id = $11
       RETURNING id, name, position, employee_code, department, email, phone, status, notes, photo, card_uid, created_at, pending_query_note, pending_query_updated_at`,
      [
        staff.name,
        staff.position,
        staff.employee_code,
        staff.department,
        staff.email,
        staff.phone,
        staff.status,
        staff.notes,
        staff.photo,
        staff.card_uid,
        staffId,
      ]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'Staff not found' });
    }

    const { rows: countRows } = await pool.query(
      'SELECT COUNT(id)::int AS fingerprint_count FROM fingerprints WHERE staff_id = $1',
      [staffId]
    );

    res.json({
      ...rows[0],
      fingerprint_count: countRows[0]?.fingerprint_count ?? 0,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update staff' });
  }
});

// DELETE /api/staff/:id — removes staff + cascades to fingerprints and sets attendance logs staff_id to null
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM staff WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete staff' });
  }
});

// PATCH /api/staff/:id/pending-query — set or clear pending query note
router.patch('/:id/pending-query', async (req, res) => {
  const staffId = Number.parseInt(req.params.id, 10);
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';

  if (Number.isNaN(staffId) || staffId <= 0) {
    return res.status(400).json({ error: 'Invalid staff id' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE staff
       SET pending_query_note = $1,
           pending_query_updated_at = CASE WHEN $1 IS NULL THEN NULL ELSE NOW() END
       WHERE id = $2
       RETURNING id, pending_query_note, pending_query_updated_at`,
      [note || null, staffId]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'Staff not found' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update pending query note' });
  }
});

export default router;

