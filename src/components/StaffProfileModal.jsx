import { useEffect, useState } from 'react';
import { getAttendanceLogs } from '../api/attendanceService';

const toPhotoSrc = (photo) => {
  if (!photo) return '';
  return photo.startsWith('data:') ? photo : `data:image/jpeg;base64,${photo}`;
};

const getInitial = (value) => String(value || '?').trim().charAt(0).toUpperCase() || '?';

const toFormState = (staff) => ({
  name: staff?.name || '',
  full_name: staff?.full_name || staff?.name || '',
  position: staff?.position || '',
  employee_code: staff?.employee_code || '',
  department: staff?.department || '',
  email: staff?.email || '',
  phone: staff?.phone || '',
  status: staff?.status || 'active',
  notes: staff?.notes || '',
  photo: staff?.photo || null,
});

const formatDateTime = (value) => {
  if (!value) return 'Not available';
  return new Date(value).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const csvEscape = (value) => {
  const text = value == null ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
};

export default function StaffProfileModal({ staff, onClose, onSave, showAttendanceHistory = true }) {
  const [form, setForm] = useState(() => toFormState(staff));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRange, setHistoryRange] = useState('month');

  const canEdit = typeof onSave === 'function';

  useEffect(() => {
    setForm(toFormState(staff));
    setEditing(false);
    setSaveError('');
  }, [staff]);

  useEffect(() => {
    if (!showAttendanceHistory) return;
    if (!staff?.id) return;

    const loadHistory = async () => {
      setHistoryLoading(true);
      try {
        const rows = await getAttendanceLogs({ staffId: staff.id, range: historyRange });
        setHistory(rows);
      } catch {
        setHistory([]);
      } finally {
        setHistoryLoading(false);
      }
    };

    loadHistory();
  }, [staff, historyRange, showAttendanceHistory]);

  if (!staff) return null;

  const profileName = form.full_name || staff.full_name || form.name || staff.name;

  const photoSrc = toPhotoSrc(form.photo || staff.photo);

  const handleFieldChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handlePhotoChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const base64 = result.includes(';base64,') ? result.split(';base64,')[1] : result;
      setForm((current) => ({ ...current, photo: base64 }));
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!canEdit) return;

    setSaving(true);
    setSaveError('');
    try {
      await onSave({
        ...form,
        full_name: form.full_name.trim(),
        position: form.position.trim(),
        employee_code: form.employee_code.trim(),
        department: form.department.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        status: form.status.trim(),
        notes: form.notes.trim(),
      });
      setEditing(false);
    } catch (error) {
      setSaveError(error.message || 'Could not save staff profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadHistory = () => {
    const rows = [
      ['Staff Name', 'Position', 'Timestamp', 'Action'],
      ...history.map((entry) => [
        entry.full_name || entry.name,
        entry.position,
        formatDateTime(entry.timestamp),
        entry.type === 'in' ? 'Clock In' : 'Clock Out',
      ]),
    ];

    const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${profileName.replaceAll(/\s+/g, '-').toLowerCase()}-attendance.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm p-4 sm:p-8 overflow-y-auto" onClick={onClose}>
      <div className="max-w-5xl mx-auto bg-white rounded-[2rem] shadow-2xl overflow-hidden" onClick={(event) => event.stopPropagation()}>
        <div className="bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.25),_transparent_35%),linear-gradient(135deg,#0f172a,#1e293b)] px-6 py-6 sm:px-8 text-white">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              {photoSrc ? (
                <img src={photoSrc} alt={profileName} className="w-20 h-20 rounded-3xl object-cover border border-white/20 shadow-lg" />
              ) : (
                <div className="w-20 h-20 rounded-3xl bg-white/10 border border-white/20 flex items-center justify-center text-3xl font-bold">
                  {getInitial(profileName)}
                </div>
              )}
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-sky-200">Staff profile</p>
                <h2 className="text-2xl font-bold mt-2">{profileName}</h2>
                <p className="text-slate-300 mt-1">{staff.position}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-lg"
            >
              ×
            </button>
          </div>
        </div>

        <div className="p-6 sm:p-8 space-y-8">
          <div className="grid grid-cols-1 xl:grid-cols-[1.2fr,0.8fr] gap-6">
            <section className="space-y-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Profile details</h3>
                  <p className="text-sm text-slate-500">Update and review the current staff information.</p>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing((current) => !current);
                      setForm(toFormState(staff));
                      setSaveError('');
                    }}
                    className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    {editing ? 'Cancel Edit' : 'Edit Profile'}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  ['full_name', 'Full name'],
                  ['position', 'Position'],
                  ['employee_code', 'Employee code'],
                  ['department', 'Department'],
                  ['email', 'Email'],
                  ['phone', 'Phone'],
                ].map(([field, label]) => (
                  <label key={field} className="space-y-1">
                    <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
                    {editing ? (
                      <input
                        name={field}
                        value={form[field]}
                        onChange={handleFieldChange}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-400"
                      />
                    ) : (
                      <div className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3 text-sm text-slate-800 min-h-[50px] flex items-center">
                        {form[field] || 'Not provided'}
                      </div>
                    )}
                  </label>
                ))}

                <label className="space-y-1">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Status</span>
                  {editing ? (
                    <select
                      name="status"
                      value={form.status}
                      onChange={handleFieldChange}
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-400"
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                      <option value="pending">Pending</option>
                    </select>
                  ) : (
                    <div className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3 text-sm text-slate-800 min-h-[50px] flex items-center capitalize">
                      {form.status || 'active'}
                    </div>
                  )}
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Photo</span>
                  <div className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-4 text-sm text-slate-800 min-h-[50px] flex items-center gap-4">
                    {photoSrc ? (
                      <img src={photoSrc} alt={profileName} className="w-16 h-16 rounded-2xl object-cover" />
                    ) : (
                      <div className="w-16 h-16 rounded-2xl bg-slate-200 flex items-center justify-center text-slate-500 font-bold">
                        {getInitial(profileName)}
                      </div>
                    )}
                    {editing ? (
                      <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold cursor-pointer">
                        Upload photo
                        <input type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />
                      </label>
                    ) : (
                      <span className="text-slate-500">{photoSrc ? 'Photo available' : 'No photo uploaded'}</span>
                    )}
                  </div>
                </label>
              </div>

              <label className="space-y-1 block">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Notes</span>
                {editing ? (
                  <textarea
                    name="notes"
                    value={form.notes}
                    onChange={handleFieldChange}
                    rows={4}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-400"
                  />
                ) : (
                  <div className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3 text-sm text-slate-800 min-h-[112px]">
                    {form.notes || 'No additional notes.'}
                  </div>
                )}
              </label>

              {saveError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {saveError}
                </div>
              )}

              {editing && canEdit && (
                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(false);
                      setForm(toFormState(staff));
                      setSaveError('');
                    }}
                    className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="px-5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 disabled:opacity-60 text-white text-sm font-bold"
                  >
                    {saving ? 'Saving...' : 'Save changes'}
                  </button>
                </div>
              )}
            </section>

            <aside className="space-y-4">
              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5 space-y-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Record summary</h3>
                  <p className="text-sm text-slate-500">Quick metadata for admin follow-up and staff support.</p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-2xl bg-white border border-slate-200 px-4 py-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Created</p>
                    <p className="text-slate-800 mt-2">{formatDateTime(staff.created_at)}</p>
                  </div>
                  <div className="rounded-2xl bg-white border border-slate-200 px-4 py-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Fingerprints</p>
                    <p className="text-slate-800 mt-2">{staff.fingerprint_count ?? 0}</p>
                  </div>
                  <div className="rounded-2xl bg-white border border-slate-200 px-4 py-3 col-span-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Pending query</p>
                    <p className="text-slate-800 mt-2">{staff.pending_query_note || 'No pending query note'}</p>
                  </div>
                </div>
              </div>
            </aside>
          </div>

          {showAttendanceHistory && (
          <section className="rounded-[1.5rem] border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Attendance history</h3>
                <p className="text-sm text-slate-500">Review logs or export the current view for audit and reporting.</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex gap-2">
                  {[
                    ['week', 'Week'],
                    ['month', 'Month'],
                    ['all', 'All'],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setHistoryRange(value)}
                      className={`px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wide border ${
                        historyRange === value
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleDownloadHistory}
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold"
                >
                  Download CSV
                </button>
              </div>
            </div>

            {historyLoading ? (
              <div className="px-5 py-12 text-center text-slate-400">Loading attendance history...</div>
            ) : history.length === 0 ? (
              <div className="px-5 py-12 text-center text-slate-400">No attendance history found for this range.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-white text-slate-500 uppercase text-xs tracking-wide">
                      <th className="px-5 py-3 text-left font-semibold">Timestamp</th>
                      <th className="px-5 py-3 text-left font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {history.map((entry) => (
                      <tr key={entry.id} className="hover:bg-slate-50">
                        <td className="px-5 py-4 text-slate-700">{formatDateTime(entry.timestamp)}</td>
                        <td className="px-5 py-4">
                          <span className={`inline-flex px-3 py-1 rounded-full text-xs font-bold ${entry.type === 'in' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                            {entry.type === 'in' ? 'Clock In' : 'Clock Out'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          )}
        </div>
      </div>
    </div>
  );
}