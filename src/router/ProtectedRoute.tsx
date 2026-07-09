import { Navigate, Outlet, useLocation } from 'react-router-dom';
import ForbiddenPage from '@/pages/common/ForbiddenPage';
import { useAuthStore } from '@/store/authStore';
import { canAccess } from './roleMenus';

export default function ProtectedRoute() {
  const user = useAuthStore((state) => state.user);
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!canAccess(location.pathname, user.role)) {
    return <ForbiddenPage />;
  }

  return <Outlet />;
}
