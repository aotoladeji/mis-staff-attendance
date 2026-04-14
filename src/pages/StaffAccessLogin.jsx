import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BRAND_LOGO_PATH, BRAND_NAME } from '../config/branding';

export default function StaffAccessLogin() {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { loginStaffAccess, hasRole } = useAuth();

  // Already authenticated as staff-access — go straight to the page
  useEffect(() => {
    if (hasRole('staff-access')) navigate('/staff-access', { replace: true });
  }, [hasRole, navigate]);
  const navigate = useNavigate();

  const handleSubmit = (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    const success = loginStaffAccess(password);
    setLoading(false);

    if (success) {
      navigate('/staff-access', { replace: true });
      return;
    }

    setError('Invalid staff access password. Please try again.');
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img
            src={BRAND_LOGO_PATH}
            alt={BRAND_NAME}
            className="w-20 h-20 object-contain mx-auto mb-4 rounded-2xl bg-white p-2 shadow-xl"
          />
          <h1 className="text-white text-2xl font-bold">{BRAND_NAME}</h1>
          <p className="text-slate-400 text-sm mt-1">Staff Access Portal</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-slate-800 text-xl font-bold mb-1">Staff Access Sign In</h2>
          <p className="text-slate-400 text-sm mb-6">Enter the staff access password to continue.</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Password</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔒</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter staff access password"
                  className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  required
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
                <span>⚠️</span> {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-blue-200 active:scale-95 disabled:opacity-60"
            >
              {loading ? 'Signing in…' : 'Open Staff Access'}
              </button>
            </form>
          </div>
          <p className="text-center text-slate-400 text-xs mt-4">
            Admin?{' '}
            <Link to="/login" className="text-blue-400 hover:underline">
              Admin Login
            </Link>
          </p>
        </div>
      </div>
    );
  }
