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

const parseTimeToMinutes = (timeStr, fallback) => {
  const str = timeStr || fallback;
  const [h, m] = String(str).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return (h * 60) + m;
};

const expectedShiftMinutes = (settings) => {
  const start = parseTimeToMinutes(settings?.shift_start, '08:00');
  const end = parseTimeToMinutes(settings?.shift_end, '17:00');
  if (start === null || end === null) return 0;

  let duration = end - start;
  if (duration <= 0) duration += 24 * 60;
  return duration;
};

/**
 * Build a lookup of clock-out log IDs that are genuinely overtime based on
 * worked minutes, not just time-of-day.
 */
export const buildOvertimeLookup = (logs, settings) => {
  const overtimeIds = new Set();
  if (!Array.isArray(logs) || logs.length === 0) return overtimeIds;

  const shiftMinutes = expectedShiftMinutes(settings);
  const overtimeThresholdMinutes = Number(settings?.overtime_min ?? 0);
  const requiredMinutes = shiftMinutes + Math.max(0, overtimeThresholdMinutes);
  if (requiredMinutes <= 0) return overtimeIds;

  const openClockIns = new Map();
  const ordered = [...logs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  for (const log of ordered) {
    if (!log?.staff_id) continue;

    const logTime = new Date(log.timestamp);
    if (Number.isNaN(logTime.getTime())) continue;

    if (log.type === 'in') {
      openClockIns.set(log.staff_id, logTime);
      continue;
    }

    if (log.type !== 'out') continue;

    const inTime = openClockIns.get(log.staff_id);
    if (!inTime) continue;

    const workedMinutes = (logTime.getTime() - inTime.getTime()) / (1000 * 60);
    if (workedMinutes > requiredMinutes) {
      overtimeIds.add(log.id);
    }

    // Close this work session after the first out.
    openClockIns.delete(log.staff_id);
  }

  return overtimeIds;
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
