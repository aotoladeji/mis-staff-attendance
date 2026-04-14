import { useState, useEffect } from 'react';
import { getSettings, updateSettings } from '../api/settingsService';
import { fmt12 } from '../utils/attendanceStatus';

export default function AttendanceSettings() {
  const [form, setForm] = useState({
    shift_start: '08:00',
    shift_end: '17:00',
    late_grace_min: 0,
    overtime_min: 0,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getSettings()
      .then((s) => {
        setForm({
          shift_start: s.shift_start,
          shift_end: s.shift_end,
          late_grace_min: s.late_grace_min,
          overtime_min: s.overtime_min,
        });
      })
      .catch(() => setError('Failed to load settings.'))
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setSaved(false);
    setForm((f) => ({ ...f, [name]: name.endsWith('_min') ? parseInt(value) || 0 : value }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await updateSettings(form);
      setSaved(true);
    } catch {
      setError('Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  // Computed preview labels
  const lateAfter = (() => {
    if (!form.shift_start) return '';
    const [h, m] = form.shift_start.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m + (form.late_grace_min || 0), 0, 0);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  })();

  const overtimeAfter = (() => {
    if (!form.shift_end) return '';
    const [h, m] = form.shift_end.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m + (form.overtime_min || 0), 0, 0);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  })();

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Attendance Settings</h1>
        <p className="text-slate-500 text-sm mt-1">Configure shift hours and late / overtime thresholds</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 text-slate-400 py-10">
          <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Loading…
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-5">
          {/* Work Schedule */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
              <span className="text-xl">🕐</span>
              <h2 className="font-bold text-slate-800">Work Schedule</h2>
            </div>
            <div className="p-6 grid grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  Shift Start
                </label>
                <input
                  type="time"
                  name="shift_start"
                  value={form.shift_start}
                  onChange={handleChange}
                  className="w-full border border-slate-200 rounded-lg px-4 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-slate-400 text-xs mt-1">{fmt12(form.shift_start)}</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  Shift End
                </label>
                <input
                  type="time"
                  name="shift_end"
                  value={form.shift_end}
                  onChange={handleChange}
                  className="w-full border border-slate-200 rounded-lg px-4 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-slate-400 text-xs mt-1">{fmt12(form.shift_end)}</p>
              </div>
            </div>
          </div>

          {/* Thresholds */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
              <span className="text-xl">⚙️</span>
              <h2 className="font-bold text-slate-800">Attendance Policy</h2>
            </div>
            <div className="p-6 space-y-6">
              {/* Late */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Late Grace Period
                  </label>
                  <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 text-xs font-bold px-2.5 py-0.5 rounded-full">
                    ⚠️ Late after {lateAfter}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    name="late_grace_min"
                    min="0"
                    max="120"
                    value={form.late_grace_min}
                    onChange={handleChange}
                    className="w-24 border border-slate-200 rounded-lg px-4 py-2.5 text-slate-800 text-center focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                  <span className="text-slate-500 text-sm">minutes after shift start</span>
                </div>
                <p className="text-slate-400 text-xs mt-1.5">
                  Clock-ins after <strong>{lateAfter}</strong> are marked as <strong>Late</strong>. Set to 0 for no grace period.
                </p>
              </div>

              {/* Overtime */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Overtime Threshold
                  </label>
                  <span className="inline-flex items-center gap-1 bg-purple-100 text-purple-700 text-xs font-bold px-2.5 py-0.5 rounded-full">
                    🕐 Overtime after {overtimeAfter}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    name="overtime_min"
                    min="0"
                    max="300"
                    value={form.overtime_min}
                    onChange={handleChange}
                    className="w-24 border border-slate-200 rounded-lg px-4 py-2.5 text-slate-800 text-center focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                  <span className="text-slate-500 text-sm">minutes after shift end</span>
                </div>
                <p className="text-slate-400 text-xs mt-1.5">
                  Clock-outs after <strong>{overtimeAfter}</strong> are marked as <strong>Overtime</strong>. Set to 0 to count any minute past shift end.
                </p>
              </div>
            </div>
          </div>

          {/* Actions */}
          {error && (
            <div className="flex items-center gap-3 px-5 py-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">
              ❌ {error}
            </div>
          )}

          {saved && (
            <div className="flex items-center gap-3 px-5 py-4 rounded-xl bg-green-50 border border-green-200 text-green-700 text-sm font-medium">
              ✅ Settings saved successfully.
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold px-8 py-3 rounded-xl transition-colors shadow-sm text-sm"
            >
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
