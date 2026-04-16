import { useEffect, useState } from 'react';
import { getStaff, deleteStaff, updatePendingQuery, updateStaff } from '../api/staffService';
import StaffProfileModal from '../components/StaffProfileModal';
const getInitial = (value) => String(value || '?').trim().charAt(0).toUpperCase() || '?';

export default function StaffManagement() {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [updatingId, setUpdatingId] = useState(null);
  const [selectedStaff, setSelectedStaff] = useState(null);

  useEffect(() => {
    loadStaff();
  }, []);

  const loadStaff = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await getStaff();
      setStaff(data);
    } catch (err) {
      setLoadError('Could not load staff — is the backend server running? (' + err.message + ')');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (window.confirm('Are you sure you want to remove this staff member?')) {
      await deleteStaff(id);
      await loadStaff();
    }
  };

  const handlePendingQuery = async (member) => {
    const current = member.pending_query_note || '';
    const note = window.prompt(
      'Enter pending query note. Leave empty and press OK to clear.',
      current
    );

    if (note === null) return;

    setUpdatingId(member.id);
    try {
      await updatePendingQuery(member.id, note);
      await loadStaff();
    } finally {
      setUpdatingId(null);
    }
  };

  const filtered = staff.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      String(s.full_name || '').toLowerCase().includes(search.toLowerCase()) ||
      s.position.toLowerCase().includes(search.toLowerCase()) ||
      String(s.employee_code || '').toLowerCase().includes(search.toLowerCase()) ||
      String(s.department || '').toLowerCase().includes(search.toLowerCase()) ||
      String(s.email || '').toLowerCase().includes(search.toLowerCase())
  );

  const handleSaveStaff = async (updates) => {
    const saved = await updateStaff(selectedStaff.id, updates);
    setSelectedStaff(saved);
    setStaff((current) => current.map((member) => (member.id === saved.id ? saved : member)));
    return saved;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Staff</h1>
          <p className="text-slate-500 text-sm mt-1">{staff.length} registered staff members</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 text-sm">🔍</span>
        <input
          type="text"
          placeholder="Search by name, position, code or department…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 border-2 border-slate-400 rounded-xl text-base font-medium text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {/* Table card */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <svg className="w-5 h-5 animate-spin mr-2" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Loading staff…
          </div>        ) : loadError ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-red-600">
            <p className="text-4xl">!</p>
            <p className="font-semibold text-sm">{loadError}</p>
            <button onClick={loadStaff} className="text-sm underline text-blue-600 hover:text-blue-800">Retry</button>
          </div>        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <p className="text-4xl mb-3">👥</p>
            <p className="font-medium">No staff found</p>
            <p className="text-sm mt-1">
              {search ? 'Try a different search term' : 'Register your first staff member'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-500 uppercase text-xs tracking-wide">
                  <th className="px-6 py-3 text-left font-semibold">Staff</th>
                  <th className="px-6 py-3 text-left font-semibold">Position</th>
                  <th className="px-6 py-3 text-left font-semibold">Code</th>
                  <th className="px-6 py-3 text-left font-semibold">Department</th>
                  <th className="px-6 py-3 text-left font-semibold">Contact</th>
                  <th className="px-6 py-3 text-left font-semibold">Status</th>
                  <th className="px-6 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <button type="button" onClick={() => setSelectedStaff(s)} className="flex items-center gap-3 text-left">
                        {s.photo ? (
                          <img src={s.photo.startsWith('data:') ? s.photo : `data:image/jpeg;base64,${s.photo}`} alt={s.name} className="w-9 h-9 rounded-full object-cover" />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm">
                            {getInitial(s.name)}
                          </div>
                        )}
                        <span className="font-medium text-slate-800 hover:text-blue-600">{s.name}</span>
                      </button>
                    </td>
                    <td className="px-6 py-4 text-slate-500">{s.position}</td>
                    <td className="px-6 py-4 text-slate-400 font-mono text-xs">{s.employee_code || `#${s.id}`}</td>
                    <td className="px-6 py-4 text-slate-500">{s.department || 'Not set'}</td>
                    <td className="px-6 py-4 text-slate-500">{s.email || s.phone || 'Not set'}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full capitalize ${s.status === 'active' ? 'bg-green-100 text-green-700' : s.status === 'inactive' ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-700'}`}>
                          {s.status || 'active'}
                        </span>
                        {s.pending_query_note && (
                          <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 text-xs font-bold px-2.5 py-1 rounded-full" title={s.pending_query_note}>
                            ⚠ Pending Query
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => setSelectedStaff(s)}
                        className="text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all mr-2"
                      >
                        View Info
                      </button>
                      <button
                        onClick={() => handlePendingQuery(s)}
                        disabled={updatingId === s.id}
                        className="text-amber-600 hover:text-amber-800 hover:bg-amber-50 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all mr-2 disabled:opacity-50"
                      >
                        {updatingId === s.id ? 'Saving...' : (s.pending_query_note ? 'Edit Query' : 'Add Query')}
                      </button>
                      <button
                        onClick={() => handleDelete(s.id)}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <StaffProfileModal
        staff={selectedStaff}
        onClose={() => setSelectedStaff(null)}
        onSave={handleSaveStaff}
      />
    </div>
  );
}
