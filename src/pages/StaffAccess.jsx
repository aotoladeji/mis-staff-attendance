import { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { bulkImportStaff, createStaff, getStaff, updateStaff } from '../api/staffService';
import StaffProfileModal from '../components/StaffProfileModal';
import { BRAND_LOGO_PATH, BRAND_NAME } from '../config/branding';

const emptyForm = {
  name: '',
  position: '',
  employee_code: '',
  department: '',
  email: '',
  phone: '',
  card_uid: '',
  status: 'active',
  notes: '',
  photo: '',
};

const normalizeHeader = (value) => String(value || '').trim().toLowerCase();

const getCellValue = (row, candidates) => {
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeHeader(candidate);
    for (const [key, value] of Object.entries(row)) {
      if (normalizeHeader(key) === normalizedCandidate) {
        return value;
      }
    }
  }
  return '';
};

const mapSpreadsheetRow = (row) => ({
  name: String(getCellValue(row, ['name', 'full name', 'staff name']) || '').trim(),
  position: String(getCellValue(row, ['position', 'role', 'title']) || '').trim(),
  employee_code: String(getCellValue(row, ['employee code', 'staff id', 'code', 'employee_id']) || '').trim(),
  department: String(getCellValue(row, ['department', 'team', 'unit']) || '').trim(),
  email: String(getCellValue(row, ['email', 'email address']) || '').trim(),
  phone: String(getCellValue(row, ['phone', 'phone number', 'mobile']) || '').trim(),
  card_uid: String(getCellValue(row, ['card uid', 'card_uid', 'rfid', 'nfc uid']) || '').trim(),
  status: String(getCellValue(row, ['status']) || 'active').trim() || 'active',
  notes: String(getCellValue(row, ['notes', 'remark', 'remarks']) || '').trim(),
  photo: String(getCellValue(row, ['photo', 'photo base64']) || '').trim(),
});

const toPhotoSrc = (photo) => {
  if (!photo) return '';
  return photo.startsWith('data:') ? photo : `data:image/jpeg;base64,${photo}`;
};

export default function StaffAccess() {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [createError, setCreateError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const fileInputRef = useRef(null);

  const loadStaff = async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await getStaff();
      setStaff(rows);
    } catch (loadError) {
      setError(loadError.message || 'Could not load staff records.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStaff();
  }, []);

  const handleCopyLink = async () => {
    const accessLink = `${window.location.origin}/staff-access`;
    try {
      await navigator.clipboard.writeText(accessLink);
      setNotice('Staff access link copied. Send it to new staff for profile updates.');
    } catch {
      setNotice(`Copy this link manually: ${accessLink}`);
    }
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setCreateError('');
    setNotice('');

    try {
      const payload = {
        ...form,
        photo: form.photo || null,
      };
      const created = await createStaff(payload);
      setStaff((current) => [...current, created].sort((left, right) => left.name.localeCompare(right.name)));
      setForm(emptyForm);
      setShowCreateModal(false);
      setNotice(`${created.name} has been added to the staff directory.`);
    } catch (submitError) {
      setCreateError(submitError.message || 'Could not add the staff member.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setNotice('');
    setError('');

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
      const mappedRows = rows.map(mapSpreadsheetRow).filter((row) => row.name && row.position);

      if (mappedRows.length === 0) {
        throw new Error('The file did not contain any rows with at least name and position columns.');
      }

      const result = await bulkImportStaff(mappedRows);
      setStaff(result.staff);
      setNotice(`Import complete: ${result.created} created, ${result.updated} updated.`);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (importError) {
      setError(importError.message || 'Could not import the staff file.');
    } finally {
      setImporting(false);
    }
  };

  const handleSaveStaff = async (updates) => {
    const saved = await updateStaff(selectedStaff.id, updates);
    setSelectedStaff(saved);
    setStaff((current) => current.map((member) => (member.id === saved.id ? saved : member)));
    setNotice(`${saved.name}'s profile was updated.`);
    return saved;
  };

  const handlePhotoUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setCreateError('Please choose a valid image file for the profile photo.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      setForm((current) => ({ ...current, photo: result }));
      setCreateError('');
    };
    reader.onerror = () => {
      setCreateError('Could not read the selected image. Please try again.');
    };
    reader.readAsDataURL(file);
  };

  const filteredStaff = staff.filter((member) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;

    return [
      member.name,
      member.position,
      member.employee_code,
      member.department,
      member.email,
      member.phone,
    ].some((field) => String(field || '').toLowerCase().includes(query));
  });

  return (
    <div className="space-y-8">
      <section className="rounded-4xl overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.18),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(14,165,233,0.18),transparent_35%),linear-gradient(135deg,#f8fafc,#e2e8f0)] border border-white/60 shadow-sm">
        <div className="px-6 py-8 sm:px-8 lg:px-10 grid grid-cols-1 xl:grid-cols-[1.2fr,0.8fr] gap-8 items-start">
          <div className="space-y-5">
            <div className="flex items-center gap-4">
              <img
                src={BRAND_LOGO_PATH}
                alt={BRAND_NAME}
                className="w-16 h-16 rounded-3xl bg-white p-2 shadow-lg object-contain"
              />
              <div>
                <p className="text-xs font-bold tracking-[0.25em] text-slate-500">{BRAND_NAME}</p>
                <p className="text-sm text-slate-500 mt-1">Reliability, Excellence, Uniqueness, and Integrity. </p>
              </div>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-xs font-bold uppercase tracking-[0.25em] text-slate-600 border border-white">
              Welcome to ITeMS
            </div>
            <div>
              <h1 className="text-4xl font-black tracking-tight text-slate-900">Staff access and profile updates</h1>
              <p className="text-slate-600 text-base mt-3 max-w-2xl">
                Profile Updates and Staff Onboarding.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleCopyLink}
                className="px-5 py-3 rounded-2xl bg-slate-900 text-white font-bold text-sm hover:bg-slate-800"
              >
                Copy staff access link
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreateError('');
                  setForm(emptyForm);
                  setShowCreateModal(true);
                }}
                className="px-5 py-3 rounded-2xl bg-sky-500 text-white font-bold text-sm hover:bg-sky-600"
              >
                Add new staff
              </button>
              <label className="px-5 py-3 rounded-2xl bg-white text-slate-700 font-bold text-sm border border-slate-200 cursor-pointer hover:bg-slate-50">
                {importing ? 'Importing...' : 'Upload Excel or CSV'}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleImportFile}
                  className="hidden"
                />
              </label>
              <a
                href="/samples/staff-import-template.xlsx"
                download
                className="px-5 py-3 rounded-2xl bg-white text-slate-700 font-bold text-sm border border-slate-200 hover:bg-slate-50"
              >
                Download Excel template
              </a>
            </div>
            {notice && <div className="rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">{notice}</div>}
            {error && <div className="rounded-2xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}
          </div>

        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Staff directory</h2>
            <p className="text-sm text-slate-500 mt-1">Click any staff card to inspect their profile and attendance history.</p>
          </div>
          <div className="relative w-full sm:w-80">
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name, code, department or contact"
              className="w-full rounded-2xl border-2 border-slate-400 bg-white px-4 py-3 text-base font-medium text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
            />
          </div>
        </div>

        {loading ? (
          <div className="rounded-3xl bg-white border border-slate-200 p-10 text-center text-slate-400">Loading staff directory...</div>
        ) : filteredStaff.length === 0 ? (
          <div className="rounded-3xl bg-white border border-slate-200 p-10 text-center text-slate-400">No staff records match this search.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredStaff.map((member) => {
              const photoSrc = toPhotoSrc(member.photo);
              return (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => setSelectedStaff(member)}
                  className="text-left rounded-[1.75rem] bg-white border border-slate-200 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all p-5 space-y-4"
                >
                  <div className="flex items-center gap-4">
                    {photoSrc ? (
                      <img src={photoSrc} alt={member.name} className="w-16 h-16 rounded-2xl object-cover" />
                    ) : (
                      <div className="w-16 h-16 rounded-2xl bg-sky-100 text-sky-700 flex items-center justify-center font-black text-xl">
                        {member.name.charAt(0)}
                      </div>
                    )}
                    <div className="min-w-0">
                      <h3 className="font-bold text-slate-900 truncate">{member.name}</h3>
                      <p className="text-sm text-slate-500 truncate">{member.position}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-2xl bg-slate-50 px-3 py-2">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Code</p>
                      <p className="text-slate-700 mt-1 truncate">{member.employee_code || 'None'}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-3 py-2">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Department</p>
                      <p className="text-slate-700 mt-1 truncate">{member.department || 'None'}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-3 py-2 col-span-2">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Contact</p>
                      <p className="text-slate-700 mt-1 truncate">{member.email || member.phone || 'No contact set'}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className={`inline-flex px-3 py-1 rounded-full font-bold capitalize ${member.status === 'active' ? 'bg-emerald-100 text-emerald-700' : member.status === 'inactive' ? 'bg-slate-200 text-slate-700' : 'bg-amber-100 text-amber-700'}`}>
                      {member.status || 'active'}
                    </span>
                    <span className="text-slate-400">View full info</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <StaffProfileModal
        staff={selectedStaff}
        onClose={() => setSelectedStaff(null)}
        onSave={handleSaveStaff}
        showAttendanceHistory={false}
      />

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close"
            onClick={() => {
              setShowCreateModal(false);
              setCreateError('');
            }}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
          />
          <form onSubmit={handleCreate} className="relative z-10 w-full max-w-3xl rounded-[1.75rem] bg-white border border-slate-200 shadow-2xl p-6 space-y-4 max-h-[90vh] overflow-auto">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Add a new staff profile</h2>
                <p className="text-sm text-slate-600 mt-1">Use this for one-off onboarding when you do not want to import a spreadsheet.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowCreateModal(false);
                  setCreateError('');
                }}
                className="px-3 py-2 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                ['name', 'Full name'],
                ['position', 'Position'],
                ['employee_code', 'Employee code'],
                ['department', 'Department'],
                ['email', 'Email'],
                ['phone', 'Phone'],
                ['card_uid', 'Card UID (NFC / RFID)'],
              ].map(([field, label]) => (
                <label key={field} className="space-y-1">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-600">{label}</span>
                  <input
                    required={field === 'name' || field === 'position'}
                    value={form[field]}
                    onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))}
                    className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </label>
              ))}
            </div>

            <label className="space-y-1 block">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-600">Notes</span>
              <textarea
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                rows={3}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </label>

            <label className="space-y-2 block">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-600">Profile picture</span>
              <div className="flex items-center gap-4 flex-wrap">
                {form.photo ? (
                  <img src={form.photo} alt="New staff preview" className="w-16 h-16 rounded-2xl object-cover border border-slate-300" />
                ) : (
                  <div className="w-16 h-16 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center font-bold border border-slate-300">
                    IMG
                  </div>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="px-4 py-2 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
                    Upload photo
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoUpload}
                      className="hidden"
                    />
                  </label>
                  {form.photo && (
                    <button
                      type="button"
                      onClick={() => setForm((current) => ({ ...current, photo: '' }))}
                      className="px-4 py-2 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
              <p className="text-xs text-slate-500">Optional. You can complete registration now and upload passport photo later.</p>
            </label>

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <select
                value={form.status}
                onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="pending">Pending</option>
              </select>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setCreateError('');
                  }}
                  className="px-5 py-3 rounded-2xl border border-slate-300 text-slate-700 font-bold text-sm hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-3 rounded-2xl bg-sky-500 hover:bg-sky-600 disabled:opacity-60 text-white font-bold text-sm"
                >
                  {submitting ? 'Saving...' : 'Create staff profile'}
                </button>
              </div>
            </div>

            {createError && <div className="rounded-2xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{createError}</div>}
          </form>
        </div>
      )}
    </div>
  );
}