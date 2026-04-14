/**
 * Parse a "HH:MM" time string and return a Date set to that time on the same
 * calendar day as `baseDate`.
 */
const timeOnDay = (baseDate, timeStr, extraMinutes = 0) => {
  const [h, m] = timeStr.split(':').map(Number);
  const d = new Date(baseDate);
  d.setHours(h, m + extraMinutes, 0, 0);
  return d;
};

/**
 * Returns true when a clock-IN timestamp qualifies as "Late".
 * Late = arrived after shift_start + late_grace_min.
 */
export const isLate = (timestamp, settings) => {
  if (!settings?.shift_start) return false;
  const ts = new Date(timestamp);
  const cutoff = timeOnDay(ts, settings.shift_start, settings.late_grace_min ?? 0);
  return ts > cutoff;
};

/**
 * Returns true when a clock-OUT timestamp qualifies as "Overtime".
 * Overtime = left after shift_end + overtime_min.
 */
export const isOvertime = (timestamp, settings) => {
  if (!settings?.shift_end) return false;
  const ts = new Date(timestamp);
  const cutoff = timeOnDay(ts, settings.shift_end, settings.overtime_min ?? 0);
  return ts > cutoff;
};

/**
 * Returns the current shift phase based on now vs the configured shift times.
 * 'pre-shift' | 'on-shift' | 'after-hours'
 */
export const shiftPhase = (now, settings) => {
  if (!settings?.shift_start || !settings?.shift_end) return null;
  const start = timeOnDay(now, settings.shift_start);
  const end = timeOnDay(now, settings.shift_end);
  if (now < start) return 'pre-shift';
  if (now <= end) return 'on-shift';
  return 'after-hours';
};

/** Format a "HH:MM" (24h) string to "H:MM AM/PM" */
export const fmt12 = (timeStr) => {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
};
