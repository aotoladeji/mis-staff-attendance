import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

// GET /api/settings
router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM attendance_settings WHERE id = 1');
    res.json(rows[0]);
  } catch (err) {
    console.error('[settings GET]', err.message);
    res.status(500).json({ error: 'Failed to fetch settings', detail: err.message });
  }
});

// PUT /api/settings
router.put('/', async (req, res) => {
  const { shift_start, shift_end, late_grace_min, overtime_min } = req.body;

  if (!shift_start || !shift_end) {
    return res.status(400).json({ error: 'shift_start and shift_end are required' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE attendance_settings
       SET shift_start = $1, shift_end = $2, late_grace_min = $3, overtime_min = $4
       WHERE id = 1
       RETURNING *`,
      [shift_start, shift_end, parseInt(late_grace_min) || 0, parseInt(overtime_min) || 0]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('[settings PUT]', err.message);
    res.status(500).json({ error: 'Failed to update settings', detail: err.message });
  }
});

export default router;
