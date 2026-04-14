import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useState } from 'react';
import { BRAND_LOGO_PATH, BRAND_NAME, BRAND_SHORT_NAME, BRAND_TAGLINE } from '../config/branding';

const NavLink = ({ to, icon, label }) => {
  const location = useLocation();
  const active = location.pathname === to;
  return (
    <Link
      to={to}
      className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
        active
          ? 'bg-blue-600 text-white shadow-md'
          : 'text-slate-300 hover:bg-slate-700 hover:text-white'
      }`}
    >
      <span className="text-lg">{icon}</span>
      {label}
    </Link>
  );
};

export default function Layout() {
  const { user, logout, logoutRole, hasRole } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const location = useLocation();
  const onAdminRoute = location.pathname.startsWith('/admin');
  const onStaffRoute = location.pathname.startsWith('/staff-access');
  const hasAdmin = hasRole('admin');
  const hasStaffAccess = hasRole('staff-access');
  const activeSessionCount = Number(hasAdmin) + Number(hasStaffAccess);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-64' : 'w-16'} bg-slate-800 flex flex-col transition-all duration-300 shrink-0`}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-slate-700">
          <img
            src={BRAND_LOGO_PATH}
            alt={BRAND_NAME}
            className="w-9 h-9 rounded-lg bg-white object-contain p-1 shrink-0"
          />
          {sidebarOpen && (
            <div>
              <p className="text-white font-bold text-sm leading-tight">{BRAND_SHORT_NAME}</p>
              <p className="text-slate-400 text-xs">{BRAND_TAGLINE}</p>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1">
          {hasStaffAccess && (
            <NavLink to="/staff-access" icon="🔗" label={sidebarOpen ? 'Staff Access' : ''} />
          )}
          {hasAdmin && (
            <>
              <NavLink to="/admin" icon="📊" label={sidebarOpen ? 'Dashboard' : ''} />
              <NavLink to="/admin/attendance" icon="📋" label={sidebarOpen ? 'Attendance' : ''} />
              <NavLink to="/admin/staff" icon="👥" label={sidebarOpen ? 'Staff' : ''} />
              <NavLink to="/admin/settings" icon="⚙️" label={sidebarOpen ? 'Settings' : ''} />
            </>
          )}
          {user && <NavLink to="/security" icon="🔐" label={sidebarOpen ? 'Security' : ''} />}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-slate-700">
          {user ? (
            <div className="space-y-1">
              {hasAdmin && (
                <button
                  onClick={() => logoutRole('admin')}
                  className="flex items-center gap-3 w-full px-4 py-3 rounded-lg text-sm font-medium text-slate-300 hover:bg-red-600 hover:text-white transition-all"
                >
                  <span className="text-lg">🛡️</span>
                  {sidebarOpen && 'Logout Admin'}
                </button>
              )}
              {hasStaffAccess && (
                <button
                  onClick={() => logoutRole('staff-access')}
                  className="flex items-center gap-3 w-full px-4 py-3 rounded-lg text-sm font-medium text-slate-300 hover:bg-red-600 hover:text-white transition-all"
                >
                  <span className="text-lg">🔗</span>
                  {sidebarOpen && 'Logout Staff Access'}
                </button>
              )}
              {(hasAdmin && hasStaffAccess) && (
                <button
                  onClick={logout}
                  className="flex items-center gap-3 w-full px-4 py-3 rounded-lg text-sm font-medium text-slate-300 hover:bg-red-700 hover:text-white transition-all border border-slate-600"
                >
                  <span className="text-lg">🚪</span>
                  {sidebarOpen && 'Logout All'}
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              <NavLink to="/login" icon="🔑" label={sidebarOpen ? 'Admin Login' : ''} />
              <NavLink to="/staff-access/login" icon="🔗" label={sidebarOpen ? 'Staff Access Login' : ''} />
            </div>
          )}
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-slate-500 hover:text-slate-800 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-3 mr-2">
              <img
                src={BRAND_LOGO_PATH}
                alt={BRAND_NAME}
                className="w-8 h-8 rounded-lg bg-slate-100 object-contain p-1"
              />
              <div className="leading-tight">
                <p className="text-sm font-semibold text-slate-800">{BRAND_NAME}</p>
                <p className="text-xs text-slate-400">Operations portal</p>
              </div>
            </div>
            {user && (
              <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-200 bg-slate-50">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  Active Sessions: {activeSessionCount}
                </span>
                {hasAdmin && (
                  <span className="inline-flex items-center gap-1 bg-blue-100 text-blue-700 text-[11px] font-semibold px-2 py-0.5 rounded-full">
                    Admin
                  </span>
                )}
                {hasStaffAccess && (
                  <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-700 text-[11px] font-semibold px-2 py-0.5 rounded-full">
                    Staff Access
                  </span>
                )}
              </div>
            )}
            {hasAdmin && (onAdminRoute || !onStaffRoute) && (
              <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs font-semibold px-3 py-1 rounded-full border border-blue-200">
                🛡️ Administrator
              </span>
            )}
            {hasStaffAccess && onStaffRoute && (
              <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 text-xs font-semibold px-3 py-1 rounded-full border border-emerald-200">
                🔗 Staff Access
              </span>
            )}
            <div className="w-8 h-8 bg-slate-200 rounded-full flex items-center justify-center text-slate-600 text-sm font-bold">
              {hasAdmin && (onAdminRoute || !onStaffRoute)
                ? 'A'
                : hasStaffAccess
                  ? 'S'
                  : '?'}
            </div>
          </div>
        </header>

        <main className="flex-1 p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
