import { Router } from 'express';
import { pool } from '../db.js';
import { broadcastAttendanceEvent, sseClients } from '../utils/sseClients.js';

const router = Router();

// GET /api/attendance/stream — SSE endpoint for real-time dashboard updates
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.add(res);

  // Keep-alive ping every 25s to prevent proxy timeouts
  const keepAlive = setInterval(() => res.write(': keepalive\n\n'), 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

// GET /api/attendance — all logs, newest first, joined with staff info
router.get('/', async (req, res) => {
  const {
    staff_id,
    range = 'all',
    page: rawPage,
    page_size: rawPageSize,
    paged: rawPaged,
  } = req.query;

  const whereClauses = [];
  const params = [];

  if (staff_id) {
    const parsedStaffId = Number.parseInt(staff_id, 10);
    if (Number.isNaN(parsedStaffId) || parsedStaffId <= 0) {
      return res.status(400).json({ error: 'staff_id must be a positive integer' });
    }
    params.push(parsedStaffId);
    whereClauses.push(`al.staff_id = $${params.length}`);
  }

  const isPaged = String(rawPaged || '').toLowerCase() === 'true' || String(rawPaged || '') === '1';

  let page = Number.parseInt(rawPage, 10);
  if (Number.isNaN(page) || page < 1) page = 1;

  let pageSize = Number.parseInt(rawPageSize, 10);
  if (Number.isNaN(pageSize) || pageSize < 1) pageSize = 50;
  pageSize = Math.min(pageSize, 100);

  let limit = isPaged ? pageSize : 500;

  if (range === 'live') {
    whereClauses.push(`al.timestamp >= NOW() - INTERVAL '24 hours'`);
    limit = isPaged ? pageSize : 50;
  } else if (range === 'today' || range === 'daily') {
    whereClauses.push(`al.timestamp::date = CURRENT_DATE`);
  } else if (range === 'history') {
    whereClauses.push(`al.timestamp::date < CURRENT_DATE`);
  } else if (range === 'week') {
    whereClauses.push(`al.timestamp >= NOW() - INTERVAL '7 days'`);
  } else if (range === 'month') {
    whereClauses.push(`al.timestamp >= NOW() - INTERVAL '1 month'`);
  } else if (range === 'yearly') {
    whereClauses.push(`al.timestamp >= NOW() - INTERVAL '1 year'`);
  } else if (range !== 'all') {
    return res.status(400).json({ error: 'range must be one of: live, today, daily, history, week, month, yearly, all' });
  }

  const whereSQL = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

  try {
    const offset = (page - 1) * limit;
    let total = null;

    if (isPaged) {
      const { rows: countRows } = await pool.query(
        `SELECT COUNT(*)::int AS total
         FROM attendance_logs al
         ${whereSQL}`,
        params
      );
      total = countRows[0]?.total ?? 0;
    }

    params.push(limit);
    const limitParamIndex = params.length;
    params.push(offset);
    const offsetParamIndex = params.length;

    const { rows } = await pool.query(`
      SELECT
        al.id,
        al.staff_id,
        al.type,
        al.timestamp,
        COALESCE(s.name, 'Unknown Staff') AS name,
        COALESCE(s.position, 'Not assigned') AS position,
        s.photo
      FROM attendance_logs al
      LEFT JOIN staff s ON s.id = al.staff_id
      ${whereSQL}
      ORDER BY al.timestamp DESC
      LIMIT $${limitParamIndex}
      OFFSET $${offsetParamIndex}
    `, params);

    if (!isPaged) {
      return res.json(rows);
    }

    const totalPages = Math.max(1, Math.ceil(total / limit));
    return res.json({
      data: rows,
      pagination: {
        page,
        pageSize: limit,
        total,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch attendance logs' });
  }
});

// POST /api/attendance — record a clock in or out event
router.post('/', async (req, res) => {
  const parsedStaffId = Number.parseInt(req.body?.staff_id, 10);
  const type = req.body?.type;

  if (!parsedStaffId || !type) {
    return res.status(400).json({ error: 'staff_id and type are required' });
  }
  if (!['in', 'out'].includes(type)) {
    return res.status(400).json({ error: 'type must be "in" or "out"' });
  }

  try {
    const { rows: staffRows } = await pool.query(
      `SELECT id, pending_query_note FROM staff WHERE id = $1`,
      [parsedStaffId]
    );

    if (!staffRows[0]) {
      return res.status(404).json({ error: 'Staff not found' });
    }

    const { rows: lastRows } = await pool.query(
      `SELECT type, timestamp
       FROM attendance_logs
       WHERE staff_id = $1
       ORDER BY timestamp DESC
       LIMIT 1`,
      [parsedStaffId]
    );

    const lastAction = lastRows[0]?.type ?? null;
    if (lastAction === type) {
      return res.status(409).json({
        error: `Invalid sequence: already clocked ${type === 'in' ? 'in' : 'out'} last`,
        irregularity: true,
        code: 'DUPLICATE_ACTION',
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO attendance_logs (staff_id, type)
       VALUES ($1, $2)
       RETURNING id, staff_id, type, timestamp`,
      [parsedStaffId, type]
    );

    const alertMessage =
      type === 'in' && staffRows[0].pending_query_note
        ? `Pending query: ${staffRows[0].pending_query_note}. Please see the Deputy Director or Director.`
        : null;

    // Broadcast to all SSE-connected dashboard clients
    const { rows: broadcastRows } = await pool.query(
      `SELECT al.id, al.staff_id, al.type, al.timestamp,
              COALESCE(s.name, 'Unknown Staff') AS name,
              COALESCE(s.position, 'Not assigned') AS position,
              s.photo
       FROM attendance_logs al
       LEFT JOIN staff s ON s.id = al.staff_id
       WHERE al.id = $1`,
      [rows[0].id]
    );
    if (broadcastRows[0]) broadcastAttendanceEvent(broadcastRows[0]);

    res.status(201).json({
      ...rows[0],
      alert_message: alertMessage,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to record attendance' });
  }
});

export default router;
