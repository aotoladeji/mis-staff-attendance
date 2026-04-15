import { useEffect, useRef, useState } from 'react';
import { getStaff } from '../api/staffService';
import { getAttendanceLogs } from '../api/attendanceService';
import { getSettings } from '../api/settingsService';
import { isLate, isOvertime } from '../utils/attendanceStatus';
import StaffProfileModal from '../components/StaffProfileModal';
import { updateStaff } from '../api/staffService';

const StatCard = ({ icon, label, value, color }) => (
  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex items-center gap-4">
    <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl ${color}`}>
      {icon}
    </div>
    <div>
      <p className="text-slate-500 text-xs font-semibold uppercase tracking-wide">{label}</p>
      <p className="text-slate-800 text-2xl font-bold mt-0.5">{value}</p>
    </div>
  </div>
);

const fmt = (iso) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const getInitial = (value) => String(value || '?').trim().charAt(0).toUpperCase() || '?';

const buildIrregularities = (logs) => {
  const byStaff = new Map();
  for (const log of logs) {
    if (!log.staff_id) continue;
    if (!byStaff.has(log.staff_id)) byStaff.set(log.staff_id, []);
    byStaff.get(log.staff_id).push(log);
  }

  const irregularities = [];

  for (const [, staffLogs] of byStaff.entries()) {
    const chronological = [...staffLogs].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    let previous = null;
    for (const current of chronological) {
      if (previous && previous.type === current.type) {
        irregularities.push({
          id: `dup-${current.id}`,
          staffName: current.name,
          timestamp: current.timestamp,
          detail: `Repeated ${current.type === 'in' ? 'Clock In' : 'Clock Out'} sequence`,
        });
      }
      previous = current;
    }
  }

  return irregularities.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
};

export default function AdminDashboard() {
  const [staff, setStaff] = useState([]);
  const [logs, setLogs] = useState([]);
  const [staffCount, setStaffCount] = useState(null);
  const [staffError, setStaffError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [settings, setSettings] = useState(null);
  const [selectedStaffId, setSelectedStaffId] = useState(null);
  const [selectedRange, setSelectedRange] = useState('week');
  const [profileStaff, setProfileStaff] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [staffRows, cfg] = await Promise.all([
          getStaff(),
          getSettings().catch(() => null),
        ]);
        setStaff(staffRows);
        setStaffCount(staffRows.length);
        setSettings(cfg);
        setStaffError('');
      } catch (err) {
        setStaff([]);
        setStaffCount(null);
        setStaffError(err?.message || 'Failed to load staff data.');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    if (loading) return;

    const fetchLogs = async () => {
      setLoadingLogs(true);
      try {
        const attendance = await getAttendanceLogs({
          staffId: selectedStaffId ?? undefined,
          range: selectedRange,
        });
        setLogs(attendance.slice(0, 200));
      } finally {
        setLoadingLogs(false);
      }
    };

    fetchLogs();
  }, [loading, selectedStaffId, selectedRange]);

  const selectedStaffIdRef = useRef(selectedStaffId);
  useEffect(() => { selectedStaffIdRef.current = selectedStaffId; }, [selectedStaffId]);

  // Real-time: open a persistent SSE connection so the dashboard updates the
  // moment a card is scanned on the mobile app (no manual refresh needed).
  useEffect(() => {
    const es = new EventSource('/api/attendance/stream');
    es.onmessage = (event) => {
      try {
        const newLog = JSON.parse(event.data);
        setLogs((prev) => {
          if (selectedStaffIdRef.current && newLog.staff_id !== selectedStaffIdRef.current) return prev;
          return [newLog, ...prev].slice(0, 200);
        });
      } catch {
        // ignore malformed events
      }
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, []);

  const selectedStaff = selectedStaffId ? staff.find((s) => s.id === selectedStaffId) : null;

  const today = new Date().toDateString();
  const todayLogs = logs.filter((l) => new Date(l.timestamp).toDateString() === today);
  const clockedInToday = new Set(todayLogs.filter((l) => l.type === 'in').map((l) => l.staff_id)).size;
  const clockedOutToday = new Set(todayLogs.filter((l) => l.type === 'out').map((l) => l.staff_id)).size;
  const lateToday = new Set(
    todayLogs
      .filter((l) => l.type === 'in' && isLate(l.timestamp, settings))
      .map((l) => l.staff_id)
  ).size;
  const pendingQueries = staff.filter((s) => !!s.pending_query_note).length;
  const irregularities = buildIrregularities(logs);
  const periodLabel = selectedRange === 'week' ? 'Last 7 days' : selectedRange === 'month' ? 'Last month' : 'All time';

  const handleSaveStaff = async (updates) => {
    const saved = await updateStaff(profileStaff.id, updates);
    setProfileStaff(saved);
    setStaff((current) => current.map((member) => (member.id === saved.id ? saved : member)));
    setLogs((current) => current.map((entry) => (
      entry.staff_id === saved.id
        ? { ...entry, name: saved.name, position: saved.position, photo: saved.photo }
        : entry
    )));
    return saved;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
        <p className="text-slate-500 text-sm mt-1">Live attendance overview</p>
      </div>

      {staffError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {staffError}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon="👥" label="Total Staff" value={staffCount ?? '--'} color="bg-blue-50" />
        <StatCard icon="→" label="Clocked In Today" value={clockedInToday} color="bg-green-50" />
        <StatCard icon="←" label="Clocked Out Today" value={clockedOutToday} color="bg-rose-50" />
        <StatCard icon="⚠️" label="Late Today" value={lateToday} color="bg-amber-50" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-slate-800 font-bold text-sm uppercase tracking-wide">Irregularities</h2>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
              {irregularities.length}
            </span>
          </div>
          {irregularities.length === 0 ? (
            <p className="text-sm text-slate-500">No irregular attendance patterns in current view.</p>
          ) : (
            <div className="space-y-2 max-h-44 overflow-auto pr-1">
              {irregularities.slice(0, 8).map((item) => (
                <div key={item.id} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
                  <p className="font-bold text-amber-800">{item.staffName}</p>
                  <p className="text-amber-700">{item.detail}</p>
                  <p className="text-amber-600 mt-0.5">{fmt(item.timestamp)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-slate-800 font-bold text-sm uppercase tracking-wide">Pending Queries</h2>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-rose-100 text-rose-700">
              {pendingQueries}
            </span>
          </div>
          {pendingQueries === 0 ? (
            <p className="text-sm text-slate-500">No staff currently flagged for administrative follow-up.</p>
          ) : (
            <div className="space-y-2 max-h-44 overflow-auto pr-1">
              {staff.filter((s) => s.pending_query_note).map((member) => (
                <button key={member.id} type="button" onClick={() => setProfileStaff(member)} className="w-full text-left rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs hover:bg-rose-100 transition-colors">
                  <p className="font-bold text-rose-800">{member.name}</p>
                  <p className="text-rose-700">{member.pending_query_note}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-slate-800 font-bold text-base">Staff Logs</h2>
          <span className="text-xs text-slate-500">Click a staff member to view only their records</span>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setSelectedStaffId(null)}
            className={`px-3 py-2 rounded-xl text-sm font-semibold whitespace-nowrap border ${
              selectedStaffId === null
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            All Staff
          </button>

          {staff.map((member) => (
            <button
              key={member.id}
              onClick={() => setSelectedStaffId(member.id)}
              className={`px-3 py-2 rounded-xl text-sm font-semibold whitespace-nowrap border ${
                selectedStaffId === member.id
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {member.name}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          {[
            { value: 'week', label: 'Week' },
            { value: 'month', label: 'Month' },
            { value: 'all', label: 'All' },
          ].map((option) => (
            <button
              key={option.value}
              onClick={() => setSelectedRange(option.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide border ${
                selectedRange === option.value
                  ? 'bg-slate-800 text-white border-slate-800'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-slate-800 font-bold text-base">
            Attendance Log {selectedStaff ? `· ${selectedStaff.name}` : ''}
          </h2>
          <span className="text-xs text-slate-400">{periodLabel} · {logs.length} records</span>
        </div>

        {loading || loadingLogs ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <svg className="w-5 h-5 animate-spin mr-2" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Loading…
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <p className="text-4xl mb-3">📋</p>
            <p className="font-medium">No attendance records yet</p>
            <p className="text-sm mt-1">Records appear here after staff clock in or out</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-500 uppercase text-xs tracking-wide">
                  <th className="px-6 py-3 text-left font-semibold">Staff</th>
                  <th className="px-6 py-3 text-left font-semibold">Position</th>
                  <th className="px-6 py-3 text-left font-semibold">Timestamp</th>
                  <th className="px-6 py-3 text-left font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {log.photo ? (
                          <img src={log.photo.startsWith('data:') ? log.photo : `data:image/jpeg;base64,${log.photo}`} alt={log.name} className="w-8 h-8 rounded-full object-cover" />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs">
                            {getInitial(log.name)}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            const match = staff.find((member) => member.id === log.staff_id);
                            if (match) setProfileStaff(match);
                          }}
                          className="font-medium text-slate-800 hover:text-blue-600"
                        >
                          {log.name || 'Unknown Staff'}
                        </button>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-500">{log.position}</td>
                    <td className="px-6 py-4 text-slate-500 font-mono text-xs">{fmt(log.timestamp)}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Clock In / Clock Out badge */}
                        <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold ${
                          log.type === 'in'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-rose-100 text-rose-700'
                        }`}>
                          {log.type === 'in' ? '→ Clock In' : '← Clock Out'}
                        </span>
                        {/* Late badge */}
                        {log.type === 'in' && isLate(log.timestamp, settings) && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">
                            ⚠️ Late
                          </span>
                        )}
                        {/* Overtime badge */}
                        {log.type === 'out' && isOvertime(log.timestamp, settings) && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-700">
                            🕐 Overtime
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <StaffProfileModal
        staff={profileStaff}
        onClose={() => setProfileStaff(null)}
        onSave={handleSaveStaff}
      />
    </div>
  );
}
