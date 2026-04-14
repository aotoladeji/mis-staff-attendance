import { Router } from 'express';
import { pool } from '../db.js';
import { findBestMatch } from '../utils/fingerprintMatch.js';
import { broadcastAttendanceEvent } from '../utils/sseClients.js';

const router = Router();

/**
 * MOBILE APP API DOCUMENTATION
 *
 * This API is designed for mobile app communication with the web app.
 * The mobile app will:
 * 1. Capture fingerprint from ZK device or smart card
 * 2. Send it to /api/mobile/verify-and-mark-attendance
 * 3. Match against registered staff in the database
 * 4. Automatically record attendance upon successful match
 *
 * Request/Response formats are optimized for mobile bandwidth and reliability.
 */

/**
 * GET /api/mobile/health
 * Health check endpoint for mobile app connectivity verification
 * Response: { status: 'ok', timestamp: ISO8601string }
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    message: 'ITeMS || Staff Attendance API is online'
  });
});

/**
 * GET /api/mobile/staff
 * List all active staff for mobile app initialization/caching
 * Returns: { staff: [{ id, name, position, department, employee_code }] }
 */
router.get('/staff', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        id,
        name,
        position,
        department,
        employee_code,
        card_uid,
        photo,
        status
      FROM staff
      WHERE status = 'active'
      ORDER BY name
    `);

    res.json({
      success: true,
      staff: rows,
      count: rows.length,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error fetching staff list:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch staff list'
    });
  }
});

/**
 * GET /api/mobile/staff/card/:uid
 * Look up a staff member by their card UID (NFC/RFID scan result).
 * Returns staff info + last attendance action so the mobile app can show
 * who tapped and whether their next action is clock-in or clock-out.
 *
 * Response: { success: true, staff: { id, name, position, ... }, last_action, last_action_time }
 * 404 if card UID is not registered to any staff member.
 */
router.get('/staff/card/:uid', async (req, res) => {
  const cardUid = req.params.uid?.trim();

  if (!cardUid) {
    return res.status(400).json({
      success: false,
      error: 'Card UID is required',
      error_code: 'MISSING_CARD_UID',
      timestamp: new Date().toISOString()
    });
  }

  try {
    const { rows } = await pool.query(`
      SELECT
        s.id,
        s.name,
        s.position,
        s.department,
        s.employee_code,
        s.card_uid,
        s.photo,
        s.status,
        s.pending_query_note,
        (SELECT type FROM attendance_logs
         WHERE staff_id = s.id
         ORDER BY timestamp DESC LIMIT 1) AS last_action,
        (SELECT timestamp FROM attendance_logs
         WHERE staff_id = s.id
         ORDER BY timestamp DESC LIMIT 1) AS last_action_time
      FROM staff s
      WHERE s.card_uid = $1
    `, [cardUid]);

    if (!rows[0]) {
      return res.status(404).json({
        success: false,
        error: 'Card not registered to any staff member',
        error_code: 'CARD_NOT_FOUND',
        timestamp: new Date().toISOString()
      });
    }

    if (rows[0].status !== 'active') {
      return res.status(403).json({
        success: false,
        error: 'Staff account is not active',
        error_code: 'STAFF_INACTIVE',
        staff: { id: rows[0].id, name: rows[0].name, status: rows[0].status },
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      staff: rows[0],
      last_action: rows[0].last_action,
      last_action_time: rows[0].last_action_time,
      next_action: rows[0].last_action === 'in' ? 'out' : 'in',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Card lookup error:', err);
    res.status(500).json({
      success: false,
      error: 'Card lookup failed',
      error_code: 'LOOKUP_ERROR',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/mobile/mark-attendance
 * PRIMARY card-scan endpoint. Call this after scanning a card.
 * Automatically determines whether to clock IN or OUT based on last action.
 *
 * Request Body: { "card_uid": "ABC123", "device_id": "optional" }
 *
 * Success Response (200):
 * {
 *   "success": true,
 *   "staff": { id, name, position, department, employee_code, photo },
 *   "attendance": { id, type, timestamp, is_late, overtime_hours, is_overtime },
 *   "alert_message": "string or null"
 * }
 *
 * 404 — card not registered
 * 409 — duplicate clock in/out (already clocked in or out)
 */
router.post('/mark-attendance', async (req, res) => {
  const cardUid = req.body?.card_uid?.trim();

  if (!cardUid) {
    return res.status(400).json({
      success: false,
      error: 'card_uid is required',
      error_code: 'MISSING_CARD_UID',
      timestamp: new Date().toISOString()
    });
  }

  const client = await pool.connect();
  try {
    // Step 1: Look up staff by card UID
    const { rows: staffRows } = await client.query(`
      SELECT id, name, position, department, employee_code, photo, status, pending_query_note,
        (SELECT type FROM attendance_logs WHERE staff_id = s.id ORDER BY timestamp DESC LIMIT 1) AS last_action
      FROM staff s
      WHERE card_uid = $1
    `, [cardUid]);

    if (!staffRows[0]) {
      return res.status(404).json({
        success: false,
        error: 'Card not registered to any staff member',
        error_code: 'CARD_NOT_FOUND',
        timestamp: new Date().toISOString()
      });
    }

    const member = staffRows[0];

    if (member.status !== 'active') {
      return res.status(403).json({
        success: false,
        error: 'Staff account is not active',
        error_code: 'STAFF_INACTIVE',
        timestamp: new Date().toISOString()
      });
    }

    // Step 2: Auto-determine next action (toggle in/out)
    const lastAction = member.last_action ?? 'out';
    const nextAction = lastAction === 'in' ? 'out' : 'in';

    // Step 3: Insert attendance record
    await client.query('BEGIN');

    const { rows: attRows } = await client.query(
      `INSERT INTO attendance_logs (staff_id, type, timestamp)
       VALUES ($1, $2, NOW())
       RETURNING id, type, timestamp`,
      [member.id, nextAction]
    );

    const attendance = attRows[0];

    // Step 4: Calculate late / overtime against shift settings
    const { rows: settingsRows } = await client.query(
      `SELECT shift_start, shift_end, late_grace_min FROM attendance_settings LIMIT 1`
    );

    const settings = settingsRows[0] || {};
    const attendanceTime = new Date(attendance.timestamp);

    const parseTime = (timeStr, defaultStr) => {
      const str = timeStr || defaultStr;
      const [hours, minutes] = str.split(':').map(Number);
      return [hours, minutes || 0];
    };

    const [shiftStartH, shiftStartM] = parseTime(settings.shift_start, '08:00');
    const [shiftEndH, shiftEndM] = parseTime(settings.shift_end, '17:00');
    const lateGraceMin = settings.late_grace_min ?? 0;
    const expectedShiftHours = ((shiftEndH * 60 + shiftEndM) - (shiftStartH * 60 + shiftStartM)) / 60;

    let is_late = false;
    let overtime_hours = 0;

    if (nextAction === 'in') {
      const shiftStart = new Date(attendanceTime);
      shiftStart.setHours(shiftStartH, shiftStartM + lateGraceMin, 0, 0);
      is_late = attendanceTime > shiftStart;
    } else {
      const { rows: clockInRows } = await client.query(
        `SELECT timestamp FROM attendance_logs
         WHERE staff_id = $1 AND type = 'in'
         AND DATE(timestamp) = DATE($2)
         ORDER BY timestamp DESC LIMIT 1`,
        [member.id, attendance.timestamp]
      );
      if (clockInRows[0]) {
        const totalHoursWorked = (new Date(attendance.timestamp) - new Date(clockInRows[0].timestamp)) / (1000 * 60 * 60);
        overtime_hours = Math.max(0, totalHoursWorked - expectedShiftHours);
      }
    }

    await client.query('COMMIT');

    // Step 5: Broadcast to all SSE-connected web dashboards
    const { rows: broadcastRows } = await client.query(
      `SELECT al.id, al.staff_id, al.type, al.timestamp, s.name, s.position, s.photo
       FROM attendance_logs al
       LEFT JOIN staff s ON s.id = al.staff_id
       WHERE al.id = $1`,
      [attendance.id]
    );
    if (broadcastRows[0]) broadcastAttendanceEvent(broadcastRows[0]);

    const alertMessage = nextAction === 'in' && member.pending_query_note
      ? `Pending query: ${member.pending_query_note}. Please see the Deputy Director or Director.`
      : null;

    res.json({
      success: true,
      staff: {
        id: member.id,
        name: member.name,
        position: member.position,
        department: member.department,
        employee_code: member.employee_code,
        photo: member.photo || null
      },
      attendance: {
        id: attendance.id,
        type: nextAction,
        timestamp: attendance.timestamp,
        is_late,
        overtime_hours: Math.round(overtime_hours * 100) / 100,
        is_overtime: overtime_hours > 0,
        shift_duration_hours: expectedShiftHours
      },
      alert_message: alertMessage,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Card attendance marking error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to mark attendance',
      error_code: 'MARKING_ERROR',
      timestamp: new Date().toISOString()
    });
  } finally {
    client.release();
  }
});

/**
 * GET /api/mobile/staff/:id
 * Get individual staff member details by ID
 * Response: { success: true, staff: { id, name, position, department, employee_code, status } }
 */
router.get('/staff/:id', async (req, res) => {
  const staffId = Number.parseInt(req.params.id, 10);

  if (Number.isNaN(staffId) || staffId <= 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid staff ID'
    });
  }

  try {
    const { rows } = await pool.query(`
      SELECT
        id,
        name,
        position,
        department,
        employee_code,
        email,
        phone,
        photo,
        status,
        created_at,
        (SELECT type FROM attendance_logs
         WHERE staff_id = $1
         ORDER BY timestamp DESC LIMIT 1) AS last_action,
        (SELECT timestamp FROM attendance_logs
         WHERE staff_id = $1
         ORDER BY timestamp DESC LIMIT 1) AS last_action_time
      FROM staff
      WHERE id = $1
    `, [staffId]);

    if (!rows[0]) {
      return res.status(404).json({
        success: false,
        error: 'Staff member not found'
      });
    }

    res.json({
      success: true,
      staff: rows[0],
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error fetching staff:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch staff details'
    });
  }
});

/**
 * POST /api/mobile/verify-fingerprint
 * CORE ENDPOINT: Verify fingerprint without marking attendance
 *
 * Request Body:
 * {
 *   "fingerprint": "<base64 encoded fingerprint image>",
 *   "device_id": "optional device identifier"
 * }
 *
 * Success Response (200):
 * {
 *   "success": true,
 *   "staff": {
 *     "id": 1,
 *     "name": "John Doe",
 *     "position": "Manager",
 *     "department": "HR",
 *     "employee_code": "EMP001",
 *     "photo": "<photo_url>"
 *   },
 *   "match_score": 92,
 *   "last_action": "in|out|null",
 *   "timestamp": "2025-04-14T10:30:00Z"
 * }
 *
 * Error Response (404):
 * {
 *   "success": false,
 *   "error": "Fingerprint not recognized",
 *   "error_code": "NO_MATCH"
 * }
 *
 * Error Response (400):
 * {
 *   "success": false,
 *   "error": "No fingerprint data provided",
 *   "error_code": "MISSING_FINGERPRINT"
 * }
 */
router.post('/verify-fingerprint', async (req, res) => {
  const { fingerprint } = req.body;

  if (!fingerprint || typeof fingerprint !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'No fingerprint data provided',
      error_code: 'MISSING_FINGERPRINT',
      timestamp: new Date().toISOString()
    });
  }

  try {
    // Load all enrolled fingerprints with staff info
    const { rows } = await pool.query(`
      SELECT
        f.id AS fp_id,
        f.staff_id,
        f.finger,
        f.image_data,
        s.id,
        s.name,
        s.position,
        s.department,
        s.employee_code,
        s.photo,
        s.status,
        (SELECT type FROM attendance_logs
         WHERE staff_id = s.id
         ORDER BY timestamp DESC LIMIT 1) AS last_action
      FROM fingerprints f
      JOIN staff s ON s.id = f.staff_id
      WHERE s.status = 'active'
    `);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No enrolled fingerprints found in system',
        error_code: 'NO_ENROLLED_PRINTS',
        timestamp: new Date().toISOString()
      });
    }

    const match = await findBestMatch(fingerprint, rows);

    if (!match) {
      return res.status(404).json({
        success: false,
        error: 'Fingerprint not recognized',
        error_code: 'NO_MATCH',
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      staff: {
        id: match.staff_id,
        name: match.name,
        position: match.position,
        department: match.department,
        employee_code: match.employee_code,
        photo: match.photo || null
      },
      match_score: Math.round(match.score * 100),
      matched_finger: match.finger,
      last_action: match.last_action,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Fingerprint verification error:', err);
    res.status(500).json({
      success: false,
      error: 'Fingerprint verification failed',
      error_code: 'VERIFICATION_ERROR',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/mobile/verify-and-mark-attendance
 * COMBINED ENDPOINT: Verify fingerprint AND automatically mark attendance
 *
 * Request Body:
 * {
 *   "fingerprint": "<base64 encoded fingerprint image>",
 *   "device_id": "optional device identifier for logging",
 *   "timestamp": "optional ISO8601 timestamp (server uses current time if not provided)"
 * }
 *
 * Success Response (200):
 * {
 *   "success": true,
 *   "staff": {
 *     "id": 1,
 *     "name": "John Doe",
 *     "position": "Manager",
 *     "department": "HR",
 *     "employee_code": "EMP001"
 *   },
 *   "attendance": {
 *     "id": 123,
 *     "type": "in",
 *     "timestamp": "2025-04-14T09:00:00Z",
 *     "is_late": false,
 *     "is_overtime": false
 *   },
 *   "match_score": 92,
 *   "timestamp": "2025-04-14T09:00:00Z"
 * }
 *
 * Conflict Response (409):
 * {
 *   "success": false,
 *   "error": "Already clocked in",
 *   "error_code": "INVALID_SEQUENCE",
 *   "staff": { "id": 1, "name": "John Doe" },
 *   "last_action": "in",
 *   "timestamp": "2025-04-14T09:00:00Z"
 * }
 */
router.post('/verify-and-mark-attendance', async (req, res) => {
  const { fingerprint } = req.body;

  if (!fingerprint || typeof fingerprint !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'No fingerprint data provided',
      error_code: 'MISSING_FINGERPRINT',
      timestamp: new Date().toISOString()
    });
  }

  const client = await pool.connect();
  try {
    // Step 1: Verify fingerprint
    const { rows: fpRows } = await client.query(`
      SELECT
        f.id AS fp_id,
        f.staff_id,
        f.finger,
        f.image_data,
        s.id,
        s.name,
        s.position,
        s.department,
        s.employee_code,
        s.photo,
        s.status,
        (SELECT type FROM attendance_logs
         WHERE staff_id = s.id
         ORDER BY timestamp DESC LIMIT 1) AS last_action,
        (SELECT timestamp FROM attendance_logs
         WHERE staff_id = s.id
         ORDER BY timestamp DESC LIMIT 1) AS last_action_time
      FROM fingerprints f
      JOIN staff s ON s.id = f.staff_id
      WHERE s.status = 'active'
    `);

    if (fpRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No enrolled fingerprints found',
        error_code: 'NO_ENROLLED_PRINTS',
        timestamp: new Date().toISOString()
      });
    }

    const match = await findBestMatch(fingerprint, fpRows);

    if (!match) {
      return res.status(404).json({
        success: false,
        error: 'Fingerprint not recognized',
        error_code: 'NO_MATCH',
        timestamp: new Date().toISOString()
      });
    }

    // Step 2: Check last action to determine if next should be 'in' or 'out'
    const lastAction = match.last_action ?? 'out'; // default to 'out' so next is 'in'
    const nextAction = lastAction === 'in' ? 'out' : 'in';

    // Step 3: Prevent duplicate consecutive actions
    if (match.last_action === nextAction) {
      return res.status(409).json({
        success: false,
        error: `Already clocked ${nextAction === 'in' ? 'in' : 'out'}`,
        error_code: 'INVALID_SEQUENCE',
        staff: {
          id: match.staff_id,
          name: match.name,
          position: match.position,
          employee_code: match.employee_code
        },
        last_action: match.last_action,
        last_action_time: match.last_action_time,
        timestamp: new Date().toISOString()
      });
    }

    // Step 4: Record attendance
    await client.query('BEGIN');

    const { rows: attRows } = await client.query(
      `INSERT INTO attendance_logs (staff_id, type, timestamp)
       VALUES ($1, $2, NOW())
       RETURNING id, type, timestamp`,
      [match.staff_id, nextAction]
    );

    const attendance = attRows[0];

    // Step 5: Calculate is_late and overtime_hours (check against settings)
    const { rows: settingsRows } = await client.query(
      `SELECT shift_start, shift_end, late_grace_min FROM attendance_settings LIMIT 1`
    );

    const settings = settingsRows[0] || {};
    const attendanceTime = new Date(attendance.timestamp);

    // Parse shift times (HH:MM format)
    const parseTime = (timeStr, defaultStr) => {
      const str = timeStr || defaultStr;
      const [hours, minutes] = str.split(':').map(Number);
      return [hours, minutes || 0];
    };

    const [shiftStartH, shiftStartM] = parseTime(settings.shift_start, '08:00');
    const [shiftEndH, shiftEndM] = parseTime(settings.shift_end, '17:00');
    const lateGraceMin = settings.late_grace_min ?? 0;

    // Calculate expected shift duration in hours
    const expectedShiftHours = ((shiftEndH * 60 + shiftEndM) - (shiftStartH * 60 + shiftStartM)) / 60;

    let is_late = false;
    let overtime_hours = 0;

    if (nextAction === 'in') {
      // Mark as late if clocked in after shift_start + late_grace_min
      const shiftStart = new Date(attendanceTime);
      shiftStart.setHours(shiftStartH, shiftStartM + lateGraceMin, 0, 0);
      is_late = attendanceTime > shiftStart;
    } else if (nextAction === 'out') {
      // For clock-out: find the corresponding clock-in from today
      const { rows: clockInRows } = await client.query(
        `SELECT timestamp FROM attendance_logs
         WHERE staff_id = $1 AND type = 'in'
         AND DATE(timestamp) = DATE($2)
         ORDER BY timestamp DESC LIMIT 1`,
        [match.staff_id, attendance.timestamp]
      );

      if (clockInRows[0]) {
        // Calculate total hours worked
        const clockInTime = new Date(clockInRows[0].timestamp);
        const clockOutTime = new Date(attendance.timestamp);
        const totalMinutesWorked = (clockOutTime - clockInTime) / (1000 * 60);
        const totalHoursWorked = totalMinutesWorked / 60;

        // Overtime = total hours worked - expected shift hours
        overtime_hours = Math.max(0, totalHoursWorked - expectedShiftHours);
      }
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      staff: {
        id: match.staff_id,
        name: match.name,
        position: match.position,
        department: match.department,
        employee_code: match.employee_code,
        photo: match.photo || null
      },
      attendance: {
        id: attendance.id,
        type: nextAction,
        timestamp: attendance.timestamp,
        is_late,
        overtime_hours: typeof overtime_hours === 'number' ? Math.round(overtime_hours * 100) / 100 : 0,
        is_overtime: overtime_hours > 0,
        shift_duration_hours: expectedShiftHours
      },
      match_score: Math.round(match.score * 100),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Verify and mark attendance error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to process fingerprint and attendance',
      error_code: 'PROCESSING_ERROR',
      timestamp: new Date().toISOString()
    });
  } finally {
    client.release();
  }
});

/**
 * POST /api/mobile/mark-attendance-manual
 * Alternative endpoint: Mark attendance by staff ID (for backup/manual entry)
 * Useful if fingerprint verification fails but staff ID is known
 *
 * Request Body:
 * {
 *   "staff_id": 1,
 *   "action": "in|out",
 *   "device_id": "optional"
 * }
 *
 * Success Response (200):
 * {
 *   "success": true,
 *   "attendance": { "id": 123, "type": "in", "timestamp": "..." },
 *   "staff": { "id": 1, "name": "John Doe" }
 * }
 *
 * Error Response (409):
 * {
 *   "success": false,
 *   "error": "Already clocked in",
 *   "error_code": "INVALID_SEQUENCE"
 * }
 */
/**
 * POST /api/mobile/enroll-fingerprint
 * Register or REPLACE the fingerprint for an existing staff member.
 *
 * When the mobile app's "Register Staff" form is submitted:
 *  - Look up the staff member by employee_code (staff ID number).
 *  - If found → delete all their old fingerprints and save the new capture.
 *  - If NOT found → return 404 so the operator knows to register on the web app first.
 *
 * Request Body:
 * {
 *   "employee_code": "EMP001",          // staff ID number from the form
 *   "finger": "right_index",            // which finger was scanned (optional label)
 *   "image_data": "<base64 template>"   // fingerprint template / image from the scanner
 * }
 *
 * Success Response (200):
 * {
 *   "success": true,
 *   "message": "Fingerprint enrolled for John Doe",
 *   "staff": { id, name, position, employee_code },
 *   "replaced": true   // always true — old prints are always wiped before the new one is saved
 * }
 *
 * 404 — employee_code not found (staff must be registered on the web app first)
 * 400 — missing employee_code or image_data
 */
router.post('/enroll-fingerprint', async (req, res) => {
  const employeeCode = typeof req.body?.employee_code === 'string' ? req.body.employee_code.trim() : '';
  const finger      = typeof req.body?.finger === 'string' ? req.body.finger.trim() || 'index' : 'index';
  const imageData   = typeof req.body?.image_data === 'string' ? req.body.image_data.trim() : '';

  if (!employeeCode) {
    return res.status(400).json({
      success: false,
      error: 'employee_code is required',
      error_code: 'MISSING_EMPLOYEE_CODE',
      timestamp: new Date().toISOString()
    });
  }

  if (!imageData) {
    return res.status(400).json({
      success: false,
      error: 'image_data (fingerprint template) is required',
      error_code: 'MISSING_IMAGE_DATA',
      timestamp: new Date().toISOString()
    });
  }

  const client = await pool.connect();
  try {
    // Look up staff by employee_code
    const { rows: staffRows } = await client.query(
      `SELECT id, name, position, employee_code, status FROM staff WHERE employee_code = $1 LIMIT 1`,
      [employeeCode]
    );

    if (!staffRows[0]) {
      return res.status(404).json({
        success: false,
        error: `No staff member found with employee code "${employeeCode}". Please register the staff on the web app first.`,
        error_code: 'STAFF_NOT_FOUND',
        timestamp: new Date().toISOString()
      });
    }

    const member = staffRows[0];

    await client.query('BEGIN');

    // Delete ALL existing fingerprints for this staff member
    const { rowCount: deleted } = await client.query(
      `DELETE FROM fingerprints WHERE staff_id = $1`,
      [member.id]
    );

    // Insert the new fingerprint capture
    await client.query(
      `INSERT INTO fingerprints (staff_id, finger, image_data) VALUES ($1, $2, $3)`,
      [member.id, finger, imageData]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `Fingerprint enrolled for ${member.name}`,
      staff: {
        id: member.id,
        name: member.name,
        position: member.position,
        employee_code: member.employee_code
      },
      replaced: deleted > 0,
      previous_count: deleted,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Fingerprint enrollment error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to enroll fingerprint',
      error_code: 'ENROLLMENT_ERROR',
      timestamp: new Date().toISOString()
    });
  } finally {
    client.release();
  }
});

router.post('/mark-attendance-manual', async (req, res) => {
  const { staff_id, action } = req.body;
  const parsedStaffId = Number.parseInt(staff_id, 10);

  if (Number.isNaN(parsedStaffId) || parsedStaffId <= 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid staff_id',
      error_code: 'INVALID_STAFF_ID',
      timestamp: new Date().toISOString()
    });
  }

  if (!['in', 'out'].includes(action)) {
    return res.status(400).json({
      success: false,
      error: 'Action must be "in" or "out"',
      error_code: 'INVALID_ACTION',
      timestamp: new Date().toISOString()
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify staff exists
    const { rows: staffRows } = await client.query(
      `SELECT id, name, position FROM staff WHERE id = $1 AND status = 'active'`,
      [parsedStaffId]
    );

    if (!staffRows[0]) {
      return res.status(404).json({
        success: false,
        error: 'Staff member not found',
        error_code: 'STAFF_NOT_FOUND',
        timestamp: new Date().toISOString()
      });
    }

    const staff = staffRows[0];

    // Check last action
    const { rows: lastRows } = await client.query(
      `SELECT type FROM attendance_logs
       WHERE staff_id = $1
       ORDER BY timestamp DESC LIMIT 1`,
      [parsedStaffId]
    );

    const lastAction = lastRows[0]?.type ?? null;

    // Prevent duplicate consecutive actions
    if (lastAction === action) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        error: `Already clocked ${action === 'in' ? 'in' : 'out'}`,
        error_code: 'INVALID_SEQUENCE',
        last_action: lastAction,
        timestamp: new Date().toISOString()
      });
    }

    // Record attendance
    const { rows: attRows } = await client.query(
      `INSERT INTO attendance_logs (staff_id, type, timestamp)
       VALUES ($1, $2, NOW())
       RETURNING id, type, timestamp`,
      [parsedStaffId, action]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      attendance: attRows[0],
      staff: {
        id: staff.id,
        name: staff.name,
        position: staff.position
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Manual attendance marking error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to mark attendance',
      error_code: 'MARKING_ERROR',
      timestamp: new Date().toISOString()
    });
  } finally {
    client.release();
  }
});

export default router;
