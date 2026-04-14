/**
 * ITeMS || Staff Attendance localStorage database
 * All data is persisted in the browser across sessions.
 */

const KEYS = {
  STAFF: 'items_staff_attendance_staff',
  ATTENDANCE: 'items_staff_attendance_logs',
};

const LEGACY_KEYS = {
  STAFF: 'attendtrack_staff',
  ATTENDANCE: 'attendtrack_attendance',
};

const read = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch {
    return [];
  }
};

const write = (key, data) => {
  localStorage.setItem(key, JSON.stringify(data));
};

const readWithFallback = (key, legacyKey) => {
  const current = read(key);
  if (current.length > 0 || !legacyKey) return current;

  const legacy = read(legacyKey);
  if (legacy.length > 0) {
    write(key, legacy);
  }
  return legacy;
};

// ── Staff ──────────────────────────────────────────────
export const dbGetStaff = () => readWithFallback(KEYS.STAFF, LEGACY_KEYS.STAFF);

export const dbSaveStaff = (staffList) => write(KEYS.STAFF, staffList);

// ── Attendance logs ────────────────────────────────────
export const dbGetAttendance = () => readWithFallback(KEYS.ATTENDANCE, LEGACY_KEYS.ATTENDANCE);

export const dbAddAttendance = (record) => {
  const logs = dbGetAttendance();
  logs.push(record);
  write(KEYS.ATTENDANCE, logs);
  return record;
};

export const dbClearAttendance = () => write(KEYS.ATTENDANCE, []);
