import { Router } from 'express';
import { pool } from '../db.js';
import { findBestMatch } from '../utils/fingerprintMatch.js';
import { broadcastAttendanceEvent } from '../utils/sseClients.js';

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
    console.error('[staff GET]', err.message);
    res.status(500).json({ error: 'Failed to fetch staff', detail: err.message });
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
               photo = COALESCE($9, photo),
               card_uid = $10
           WHERE id = $11`,
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
            existing.id,
          ]
        );
        updated += 1;
      } else {
        await client.query(
          `INSERT INTO staff (name, position, employee_code, department, email, phone, status, notes, photo, card_uid)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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

// ---------------------------------------------------------------------------
// MOBILE APP COMPATIBILITY ENDPOINTS
// The Android app calls these three paths. They map to the same DB logic
// as the existing /api/mobile/* routes but with the body-shape the app sends.
// ---------------------------------------------------------------------------

const readAny = (payload, keys) => {
  for (const key of keys) {
    const value = payload?.[key];
    if (value !== undefined && value !== null && `${value}`.trim() !== '') return value;
  }
  return null;
};

const normalizeMethod = (value) => {
  const v = String(value || '').trim().toLowerCase();
  if (['card', 'nfc', 'rfid', 'carduid', 'card_uid'].includes(v)) return 'card';
  if (['fingerprint', 'biometric', 'biometrics', 'fp'].includes(v)) return 'fingerprint';
  return null;
};

const normalizeAction = (value) => {
  const v = String(value || '').trim().toLowerCase();
  if (['in', 'clock_in', 'clock-in', 'checkin', 'check-in', 'clockin'].includes(v)) return 'in';
  if (['out', 'clock_out', 'clock-out', 'checkout', 'check-out', 'clockout'].includes(v)) return 'out';
  return null;
};

/**
 * POST /api/staff/clock
 * Body: { action?, method, cardUid?, fingerprintTemplate?, clientTimestamp? }
 *   method      = "card" | "fingerprint"
 *   action      = "in" | "out" | omit for auto-toggle
 *   cardUid     = required when method === "card"
 *   fingerprintTemplate = required when method === "fingerprint"
 */
router.post('/clock', async (req, res) => {
  const payload = req.body ?? {};
  const cardUid = String(readAny(payload, ['cardUid', 'card_uid', 'uid', 'nfcUid', 'rfid']) || '').trim();
  const fingerprintTemplate = String(readAny(payload, ['fingerprintTemplate', 'fingerprint', 'template', 'finger_template']) || '').trim();
  const normalizedMethod = normalizeMethod(readAny(payload, ['method', 'type']));
  const method = normalizedMethod || (cardUid ? 'card' : (fingerprintTemplate ? 'fingerprint' : null));
  const requestedAction = normalizeAction(readAny(payload, ['action', 'attendanceAction', 'clockAction']));

  const client = await pool.connect();
  try {
    let member;

    if (method === 'card') {
      if (!cardUid) {
        return res.status(400).json({ success: false, error: 'cardUid is required for card method', error_code: 'MISSING_CARD_UID' });
      }
      const { rows } = await client.query(`
        SELECT id, name, position, department, employee_code, photo, status, pending_query_note,
          (SELECT type FROM attendance_logs WHERE staff_id = s.id ORDER BY timestamp DESC LIMIT 1) AS last_action
        FROM staff s WHERE card_uid = $1
      `, [cardUid]);
      if (!rows[0]) return res.status(404).json({ success: false, error: 'Card not registered', error_code: 'CARD_NOT_FOUND' });
      member = rows[0];
    } else if (method === 'fingerprint') {
      if (!fingerprintTemplate || typeof fingerprintTemplate !== 'string') {
        return res.status(400).json({ success: false, error: 'fingerprintTemplate is required for fingerprint method', error_code: 'MISSING_FINGERPRINT' });
      }
      const { rows: fpRows } = await client.query(`
        SELECT f.id AS fp_id, f.staff_id, f.finger, f.image_data,
          s.id, s.name, s.position, s.department, s.employee_code, s.photo, s.status, s.pending_query_note,
          (SELECT type FROM attendance_logs WHERE staff_id = s.id ORDER BY timestamp DESC LIMIT 1) AS last_action
        FROM fingerprints f JOIN staff s ON s.id = f.staff_id WHERE s.status = 'active'
      `);
      if (fpRows.length === 0) return res.status(404).json({ success: false, error: 'No enrolled fingerprints', error_code: 'NO_ENROLLED_PRINTS' });
      const match = await findBestMatch(fingerprintTemplate, fpRows);
      if (!match) return res.status(404).json({ success: false, error: 'Fingerprint not recognized', error_code: 'NO_MATCH' });
      const { rows: staffRows } = await client.query(`
        SELECT id, name, position, department, employee_code, photo, status, pending_query_note,
          (SELECT type FROM attendance_logs WHERE staff_id = id ORDER BY timestamp DESC LIMIT 1) AS last_action
        FROM staff WHERE id = $1
      `, [match.staff_id]);
      member = staffRows[0];
      member._match_score = Math.round(match.score * 100);
    } else {
      return res.status(400).json({ success: false, error: 'method must be "card" or "fingerprint"', error_code: 'INVALID_METHOD' });
    }

    if (!member || member.status !== 'active') {
      return res.status(403).json({ success: false, error: 'Staff account is not active', error_code: 'STAFF_INACTIVE' });
    }

    const lastAction = member.last_action ?? 'out';
    const nextAction = requestedAction === 'in' || requestedAction === 'out'
      ? requestedAction
      : (lastAction === 'in' ? 'out' : 'in');

    await client.query('BEGIN');
    const { rows: attRows } = await client.query(
      `INSERT INTO attendance_logs (staff_id, type, timestamp) VALUES ($1, $2, NOW()) RETURNING id, type, timestamp`,
      [member.id, nextAction]
    );
    const attendance = attRows[0];

    const { rows: settingsRows } = await client.query(`SELECT shift_start, shift_end, late_grace_min FROM attendance_settings LIMIT 1`);
    const settings = settingsRows[0] || {};
    const parseTime = (t, def) => { const s = t || def; const [h, m] = s.split(':').map(Number); return [h, m || 0]; };
    const [shiftStartH, shiftStartM] = parseTime(settings.shift_start, '08:00');
    const [shiftEndH, shiftEndM] = parseTime(settings.shift_end, '17:00');
    const lateGraceMin = settings.late_grace_min ?? 0;
    const expectedShiftHours = ((shiftEndH * 60 + shiftEndM) - (shiftStartH * 60 + shiftStartM)) / 60;
    const attendanceTime = new Date(attendance.timestamp);
    let is_late = false;
    let overtime_hours = 0;

    if (nextAction === 'in') {
      const shiftStart = new Date(attendanceTime);
      shiftStart.setHours(shiftStartH, shiftStartM + lateGraceMin, 0, 0);
      is_late = attendanceTime > shiftStart;
    } else {
      const { rows: ciRows } = await client.query(
        `SELECT timestamp FROM attendance_logs WHERE staff_id = $1 AND type = 'in' AND DATE(timestamp) = DATE($2) ORDER BY timestamp DESC LIMIT 1`,
        [member.id, attendance.timestamp]
      );
      if (ciRows[0]) {
        const worked = (attendanceTime - new Date(ciRows[0].timestamp)) / (1000 * 60 * 60);
        overtime_hours = Math.max(0, worked - expectedShiftHours);
      }
    }

    await client.query('COMMIT');

    broadcastAttendanceEvent({ id: attendance.id, staff_id: member.id, type: nextAction, timestamp: attendance.timestamp, name: member.name, position: member.position, photo: member.photo });

    res.json({
      success: true,
      staff: { id: member.id, name: member.name, position: member.position, department: member.department, employee_code: member.employee_code, photo: member.photo || null },
      attendance: { id: attendance.id, type: nextAction, timestamp: attendance.timestamp, is_late, overtime_hours: Math.round(overtime_hours * 100) / 100, is_overtime: overtime_hours > 0 },
      ...(member._match_score !== undefined ? { match_score: member._match_score } : {}),
      alert_message: nextAction === 'in' && member.pending_query_note ? `Pending query: ${member.pending_query_note}` : null,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[clock] error:', err);
    res.status(500).json({ success: false, error: 'Failed to record attendance', error_code: 'SERVER_ERROR' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/staff/register
 * Enrolls/updates fingerprint for an existing staff member (lookup by employee_code).
 * Also updates photo if provided.
 * Body: { staffId, fullName?, department?, photoBase64?, fingerprintTemplate }
 */
router.post('/register', async (req, res) => {
  const payload = req.body ?? {};
  const staffId = String(readAny(payload, ['staffId', 'staff_id', 'employeeCode', 'employee_code', 'code']) || '').trim();
  const fullName = String(readAny(payload, ['fullName', 'name', 'staffName']) || '').trim();
  const department = String(readAny(payload, ['department', 'dept', 'unit']) || '').trim();
  const position = String(readAny(payload, ['position', 'role', 'title']) || 'Staff').trim();
  const photoBase64 = String(readAny(payload, ['photoBase64', 'photo', 'imageBase64']) || '').trim();
  const fingerprintTemplate = String(readAny(payload, ['fingerprintTemplate', 'fingerprint', 'template', 'finger_template']) || '').trim();

  if (!staffId) return res.status(400).json({ success: false, error: 'staffId is required', error_code: 'MISSING_STAFF_ID' });

  const client = await pool.connect();
  let inTransaction = false;
  try {
    // Look up by employee_code first, fall back to numeric id
    const isNumeric = /^\d+$/.test(String(staffId));
    const { rows } = await client.query(
      isNumeric
        ? `SELECT id, name, employee_code FROM staff WHERE employee_code = $1 OR id = $1::int LIMIT 1`
        : `SELECT id, name, employee_code FROM staff WHERE employee_code = $1 LIMIT 1`,
      [staffId]
    );
    let dbId;
    let name;
    let employee_code;

    if (!rows[0]) {
      const { rows: createdRows } = await client.query(
        `INSERT INTO staff (name, position, employee_code, department, status)
         VALUES ($1, $2, $3, $4, 'active')
         RETURNING id, name, employee_code`,
        [fullName || staffId, position || 'Staff', staffId, department || null]
      );
      dbId = createdRows[0].id;
      name = createdRows[0].name;
      employee_code = createdRows[0].employee_code;
    } else {
      dbId = rows[0].id;
      name = rows[0].name;
      employee_code = rows[0].employee_code;

      // Update profile metadata when provided
      await client.query(
        `UPDATE staff
         SET name = COALESCE(NULLIF($1, ''), name),
             department = COALESCE(NULLIF($2, ''), department),
             position = COALESCE(NULLIF($3, ''), position)
         WHERE id = $4`,
        [fullName, department, position, dbId]
      );
    }

    await client.query('BEGIN');
    inTransaction = true;
    if (fingerprintTemplate) {
      // Replace all existing fingerprints with the new one
      await client.query(`DELETE FROM fingerprints WHERE staff_id = $1`, [dbId]);
      await client.query(`INSERT INTO fingerprints (staff_id, finger, image_data) VALUES ($1, 'right_index', $2)`, [dbId, fingerprintTemplate]);
    }

    if (photoBase64) {
      await client.query(`UPDATE staff SET photo = $1 WHERE id = $2`, [photoBase64, dbId]);
    }
    await client.query('COMMIT');
    inTransaction = false;

    res.json({
      success: true,
      staff: { id: dbId, name: fullName || name, employee_code },
      message: fingerprintTemplate ? 'Fingerprint enrolled successfully' : 'Staff profile registered (no fingerprint supplied)',
    });
  } catch (err) {
    if (inTransaction) await client.query('ROLLBACK');
    console.error('[register] error:', err);
    res.status(500).json({ success: false, error: 'Enrollment failed', error_code: 'SERVER_ERROR' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/staff/lookup
 * Look up a staff member by employee_code or numeric id.
 * Body: { staffId }
 */
router.post('/lookup', async (req, res) => {
  const payload = req.body ?? {};
  const staffId = String(readAny(payload, ['staffId', 'staff_id', 'employeeCode', 'employee_code', 'code']) || '').trim();
  if (!staffId) return res.status(400).json({ success: false, error: 'staffId is required', error_code: 'MISSING_STAFF_ID' });

  try {
    const isNumeric = /^\d+$/.test(String(staffId));
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.position, s.department, s.employee_code, s.photo, s.status, s.card_uid,
        COUNT(f.id)::int AS fingerprint_count,
        (SELECT type FROM attendance_logs WHERE staff_id = s.id ORDER BY timestamp DESC LIMIT 1) AS last_action,
        (SELECT timestamp FROM attendance_logs WHERE staff_id = s.id ORDER BY timestamp DESC LIMIT 1) AS last_action_time
       FROM staff s LEFT JOIN fingerprints f ON f.staff_id = s.id
       WHERE ${isNumeric ? 's.employee_code = $1 OR s.id = $1::int' : 's.employee_code = $1'}
       GROUP BY s.id LIMIT 1`,
      [staffId]
    );
    if (!rows[0]) {
      return res.json({
        success: false,
        found: false,
        error: 'Staff member not found',
        error_code: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
    }
    res.json({ success: true, staff: rows[0], last_action: rows[0].last_action, last_action_time: rows[0].last_action_time, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[lookup] error:', err);
    res.status(500).json({ success: false, error: 'Lookup failed', error_code: 'SERVER_ERROR' });
  }
});

// ---------------------------------------------------------------------------

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

