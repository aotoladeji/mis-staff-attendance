import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';

const ROLE_LABELS = {
  admin: 'Admin password',
  'staff-access': 'Staff access password',
};

export default function PasswordSettings({ forcedRole }) {
  const { user, changePassword } = useAuth();
  const userRoles = user?.roles || (user?.role ? [user.role] : []);
  const availableRoles = forcedRole ? userRoles.filter((role) => role === forcedRole) : userRoles;
  const [targetRole, setTargetRole] = useState(availableRoles[0] || forcedRole || 'admin');
  const [form, setForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!availableRoles.includes(targetRole)) {
      setTargetRole(availableRoles[0] || 'admin');
    }
  }, [availableRoles, targetRole, forcedRole]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setError('');
    setSuccess('');
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (form.newPassword !== form.confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    const result = changePassword({
      role: targetRole,
      currentPassword: form.currentPassword,
      newPassword: form.newPassword,
    });

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setSuccess('Password updated successfully.');
    setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
  };

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Security</h1>
        <p className="text-slate-500 text-sm mt-1">Change the password for the selected access level.</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-5">
        <div>
          <h2 className="font-bold text-slate-800">{ROLE_LABELS[targetRole] || 'Password'}</h2>
          <p className="text-sm text-slate-500 mt-1">Use a password you can share only with the right operators.</p>
        </div>

        {availableRoles.length > 1 && (
          <label className="block space-y-1">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Account type</span>
            <select
              value={targetRole}
              onChange={(event) => {
                setTargetRole(event.target.value);
                setError('');
                setSuccess('');
              }}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {availableRoles.map((role) => (
                <option key={role} value={role}>{ROLE_LABELS[role]}</option>
              ))}
            </select>
          </label>
        )}

        <label className="block space-y-1">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Current password</span>
          <input
            type="password"
            name="currentPassword"
            value={form.currentPassword}
            onChange={handleChange}
            className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-500">New password</span>
          <input
            type="password"
            name="newPassword"
            value={form.newPassword}
            onChange={handleChange}
            className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Confirm new password</span>
          <input
            type="password"
            name="confirmPassword"
            value={form.confirmPassword}
            onChange={handleChange}
            className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </label>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {success && <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{success}</div>}

        <div className="flex justify-end">
          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-3 rounded-xl transition-colors shadow-sm text-sm"
          >
            Update Password
          </button>
        </div>
      </form>
    </div>
  );
}