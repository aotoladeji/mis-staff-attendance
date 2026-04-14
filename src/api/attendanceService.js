/**
 * Record a clock-in or clock-out event in PostgreSQL.
 */
export const recordAttendance = async (staffId, type) => {
  const res = await fetch('/api/attendance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ staff_id: staffId, type }),
  });

  if (!res.ok) {
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
    throw new Error(payload?.error || 'Failed to record attendance');
  }
  return res.json();
};

/**
 * Fetch all attendance logs (joined with staff info) from PostgreSQL.
 */
export const getAttendanceLogs = async ({ staffId, range = 'all' } = {}) => {
  const params = new URLSearchParams();
  if (staffId) params.set('staff_id', String(staffId));
  if (range && range !== 'all') params.set('range', range);

  const query = params.toString();
  const res = await fetch(`/api/attendance${query ? `?${query}` : ''}`);
  if (!res.ok) throw new Error('Failed to fetch attendance logs');
  return res.json();
};

