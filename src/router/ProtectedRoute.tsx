import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Button, Result } from 'antd';
import ForbiddenPage from '@/pages/common/ForbiddenPage';
import { useAuthStore } from '@/store/authStore';
import { canAccess } from './roleMenus';

export default function ProtectedRoute() {
  const user = useAuthStore((state) => state.user);
  const initializationError = useAuthStore((state) => state.initializationError);
  const initialize = useAuthStore((state) => state.initialize);
  const location = useLocation();

  if (initializationError) {
    return (
      <Result
        status="error"
        title="无法恢复登录状态"
        subTitle={initializationError}
        extra={<Button type="primary" onClick={() => void initialize(true)}>重试</Button>}
      />
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!canAccess(location.pathname, user.role)) {
    return <ForbiddenPage />;
  }

  return <Outlet />;
}
