import { useEffect, useMemo, useState } from 'react';
import { getAttendanceLogs } from '../api/attendanceService';
import { getStaff, updateStaff } from '../api/staffService';
import { getSettings } from '../api/settingsService';
import { isLate, isOvertime } from '../utils/attendanceStatus';
import StaffProfileModal from '../components/StaffProfileModal';

const CATEGORY_OPTIONS = [
  { value: 'live', label: 'Live Reading', description: 'Latest 24 hours, auto-refreshing feed' },
  { value: 'daily', label: 'Daily', description: 'Today\'s attendance records' },
  { value: 'week', label: 'Weekly', description: 'Last 7 days of logs' },
  { value: 'month', label: 'Monthly', description: 'Last 30 days of logs' },
  { value: 'yearly', label: 'Yearly', description: 'Last 12 months of logs' },
];

const formatTimestamp = (value) =>
  new Date(value).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const getInitial = (value) => String(value || '?').trim().charAt(0).toUpperCase() || '?';

export default function AdminAttendance() {
  const [category, setCategory] = useState('live');
  const [logs, setLogs] = useState([]);
  const [staff, setStaff] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedStaffId, setSelectedStaffId] = useState(null);
  const [profileStaff, setProfileStaff] = useState(null);

  useEffect(() => {
    const loadStaticData = async () => {
      try {
        const [staffRows, config] = await Promise.all([
          getStaff(),
          getSettings().catch(() => null),
        ]);
        setStaff(staffRows);
        setSettings(config);
      } catch (loadError) {
        setError(loadError.message || 'Failed to load attendance data.');
      }
    };

    loadStaticData();
  }, []);

  useEffect(() => {
    let intervalId = null;

    const loadLogs = async () => {
      setLoading(true);
      setError('');
      try {
        const rows = await getAttendanceLogs({
          staffId: selectedStaffId ?? undefined,
          range: category,
        });
        setLogs(rows);
      } catch (loadError) {
        setError(loadError.message || 'Failed to fetch attendance logs.');
      } finally {
        setLoading(false);
      }
    };

    loadLogs();

    if (category === 'live') {
      intervalId = window.setInterval(loadLogs, 15000);
    }

    return () => {
      if (intervalId) {
        window.clearInterval(intervalId);
      }
    };
  }, [category, selectedStaffId]);

  const selectedCategory = CATEGORY_OPTIONS.find((option) => option.value === category);
  const selectedStaff = selectedStaffId ? staff.find((member) => member.id === selectedStaffId) : null;

  const stats = useMemo(() => {
    const inCount = logs.filter((log) => log.type === 'in').length;
    const outCount = logs.filter((log) => log.type === 'out').length;
    const lateCount = logs.filter((log) => log.type === 'in' && isLate(log.timestamp, settings)).length;
    const overtimeCount = logs.filter((log) => log.type === 'out' && isOvertime(log.timestamp, settings)).length;

    return [
      { label: 'Total Readings', value: logs.length, tone: 'bg-slate-100 text-slate-700' },
      { label: 'Clock In', value: inCount, tone: 'bg-emerald-100 text-emerald-700' },
      { label: 'Clock Out', value: outCount, tone: 'bg-rose-100 text-rose-700' },
      { label: 'Flags', value: lateCount + overtimeCount, tone: 'bg-amber-100 text-amber-700' },
    ];
  }, [logs, settings]);

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
        <h1 className="text-2xl font-bold text-slate-800">Attendance Categories</h1>
        <p className="text-slate-500 text-sm mt-1">Review attendance logs by live reading, daily, weekly, monthly, and yearly windows.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
        {CATEGORY_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setCategory(option.value)}
            className={`text-left rounded-2xl border p-4 transition-all ${
              category === option.value
                ? 'bg-slate-900 border-slate-900 text-white shadow-lg'
                : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:shadow-sm'
            }`}
          >
            <p className="font-bold text-sm">{option.label}</p>
            <p className={`text-xs mt-1 ${category === option.value ? 'text-slate-300' : 'text-slate-500'}`}>{option.description}</p>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <span className={`inline-flex px-3 py-1 rounded-full text-xs font-bold ${stat.tone}`}>{stat.label}</span>
            <p className="text-3xl font-black text-slate-900 mt-4">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{selectedCategory?.label}</h2>
            <p className="text-sm text-slate-500">{selectedCategory?.description}</p>
          </div>
          <span className="text-xs font-semibold text-slate-400">
            {category === 'live' ? 'Auto-refreshes every 15 seconds' : `${logs.length} records`}
          </span>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            type="button"
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
              type="button"
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
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-slate-800 font-bold text-base">
            {selectedCategory?.label} Log {selectedStaff ? `· ${selectedStaff.name}` : ''}
          </h2>
          <span className="text-xs text-slate-400">{logs.length} records</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <svg className="w-5 h-5 animate-spin mr-2" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Loading attendance records…
          </div>
        ) : error ? (
          <div className="px-6 py-10 text-sm text-red-700 bg-red-50 border-t border-red-100">{error}</div>
        ) : logs.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <p className="text-4xl mb-3">📋</p>
            <p className="font-medium">No attendance records in this category</p>
            <p className="text-sm mt-1">Try another category or staff filter.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-500 uppercase text-xs tracking-wide">
                  <th className="px-6 py-3 text-left font-semibold">Staff</th>
                  <th className="px-6 py-3 text-left font-semibold">Position</th>
                  <th className="px-6 py-3 text-left font-semibold">Timestamp</th>
                  <th className="px-6 py-3 text-left font-semibold">Category</th>
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
                    <td className="px-6 py-4 text-slate-500 font-mono text-xs">{formatTimestamp(log.timestamp)}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold ${
                          log.type === 'in' ? 'bg-green-100 text-green-700' : 'bg-rose-100 text-rose-700'
                        }`}>
                          {log.type === 'in' ? '→ Clock In' : '← Clock Out'}
                        </span>
                        {log.type === 'in' && isLate(log.timestamp, settings) && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">
                            ⚠️ Late
                          </span>
                        )}
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