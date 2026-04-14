import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const AuthContext = createContext();

const STORAGE_KEYS = {
  user: 'items_staff_attendance_auth_user',
  passwords: 'items_staff_attendance_auth_passwords',
};

const DEFAULT_PASSWORDS = {
  admin: 'admin123',
  'staff-access': 'oladeji',
};

const VALID_ROLES = ['admin', 'staff-access'];

const readJson = (key, fallback) => {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const normalizeUser = (rawUser) => {
  if (!rawUser) return null;

  if (Array.isArray(rawUser.roles)) {
    const roles = [...new Set(rawUser.roles)].filter((role) => VALID_ROLES.includes(role));
    if (roles.length === 0) return null;
    const role = roles.includes(rawUser.role) ? rawUser.role : roles[0];
    return { role, roles };
  }

  if (typeof rawUser.role === 'string' && VALID_ROLES.includes(rawUser.role)) {
    return { role: rawUser.role, roles: [rawUser.role] };
  }

  return null;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => normalizeUser(readJson(STORAGE_KEYS.user, null)));
  const [passwords, setPasswords] = useState(() => ({
    ...DEFAULT_PASSWORDS,
    ...readJson(STORAGE_KEYS.passwords, {}),
  }));

  const getStoredUser = () => normalizeUser(readJson(STORAGE_KEYS.user, null));

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
  }, [user]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.passwords, JSON.stringify(passwords));
  }, [passwords]);

  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === STORAGE_KEYS.user) {
        setUser(normalizeUser(readJson(STORAGE_KEYS.user, null)));
      }

      if (event.key === STORAGE_KEYS.passwords) {
        setPasswords({
          ...DEFAULT_PASSWORDS,
          ...readJson(STORAGE_KEYS.passwords, {}),
        });
      }
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const hasRole = (role) => Boolean(user?.roles?.includes(role));

  const grantRoleSession = (role) => {
    if (!VALID_ROLES.includes(role)) return;
    setUser((current) => {
      const storedRoles = getStoredUser()?.roles ?? [];
      const existingRoles = current?.roles ?? [];
      const roles = [...new Set([...storedRoles, ...existingRoles, role])];
      return { role, roles };
    });
  };

  const loginAdmin = (password) => {
    if (password === passwords.admin) {
      grantRoleSession('admin');
      return true;
    }
    return false;
  };

  const loginStaffAccess = (password) => {
    if (password === passwords['staff-access']) {
      grantRoleSession('staff-access');
      return true;
    }
    return false;
  };

  const logout = () => setUser(null);

  const logoutRole = (role) => {
    if (!VALID_ROLES.includes(role)) return;

    setUser((current) => {
      const storedRoles = getStoredUser()?.roles ?? [];
      const existingRoles = current?.roles ?? [];
      const mergedRoles = [...new Set([...storedRoles, ...existingRoles])];
      const roles = mergedRoles.filter((entry) => entry !== role);

      if (roles.length === 0) {
        return null;
      }

      const preferredRole = current?.role;
      const nextRole = roles.includes(preferredRole) ? preferredRole : roles[0];

      return { role: nextRole, roles };
    });
  };

  const changePassword = ({ role, currentPassword, newPassword }) => {
    if (!role || !passwords[role]) {
      return { ok: false, error: 'Unknown account type.' };
    }

    if (passwords[role] !== currentPassword) {
      return { ok: false, error: 'Current password is incorrect.' };
    }

    if (!newPassword || newPassword.trim().length < 4) {
      return { ok: false, error: 'New password must be at least 4 characters.' };
    }

    setPasswords((current) => ({
      ...current,
      [role]: newPassword.trim(),
    }));

    return { ok: true };
  };

  const value = useMemo(() => ({
    user,
    hasRole,
    loginAdmin,
    loginStaffAccess,
    logout,
    logoutRole,
    changePassword,
  }), [user, passwords]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
