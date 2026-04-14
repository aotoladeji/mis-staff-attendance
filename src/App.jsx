import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import AdminDashboard from './pages/AdminDashboard';
import AdminAttendance from './pages/AdminAttendance';
import StaffManagement from './pages/StaffManagement';
import StaffAccess from './pages/StaffAccess';
import StaffAccessLogin from './pages/StaffAccessLogin';
import AttendanceSettings from './pages/AttendanceSettings';
import PasswordSettings from './pages/PasswordSettings';

function PrivateRoute({ children, allowedRoles }) {
  const { user, hasRole } = useAuth();
  const redirectTo = allowedRoles?.includes('staff-access') && !allowedRoles?.includes('admin')
    ? '/staff-access/login'
    : '/login';

  if (!user) {
    return <Navigate to={redirectTo} replace />;
  }

  if (!allowedRoles || allowedRoles.some((role) => hasRole(role))) {
    return children;
  }

  return <Navigate to={redirectTo} replace />;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/staff-access/login" element={<StaffAccessLogin />} />
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/login" replace />} />
            <Route path="staff-access" element={
              <PrivateRoute allowedRoles={['staff-access']}><StaffAccess /></PrivateRoute>
            } />
            <Route path="admin" element={
              <PrivateRoute allowedRoles={['admin']}><AdminDashboard /></PrivateRoute>
            } />
            <Route path="admin/attendance" element={
              <PrivateRoute allowedRoles={['admin']}><AdminAttendance /></PrivateRoute>
            } />
            <Route path="admin/staff" element={
              <PrivateRoute allowedRoles={['admin']}><StaffManagement /></PrivateRoute>
            } />
            <Route path="admin/settings" element={
              <PrivateRoute allowedRoles={['admin']}><AttendanceSettings /></PrivateRoute>
            } />
            <Route path="security" element={
              <PrivateRoute allowedRoles={['admin', 'staff-access']}><PasswordSettings /></PrivateRoute>
            } />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
