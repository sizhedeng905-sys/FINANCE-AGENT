import { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { App, Avatar, Button, Layout, Menu, Space, Tag, Typography } from 'antd';
import { useAuthStore } from '@/store/authStore';
import { useWorkOrderStore } from '@/store/workOrderStore';
import { useNotificationStore } from '@/store/notificationStore';
import { useReportStore } from '@/store/reportStore';
import { findMenuKey, getDefaultPath, isValidRole, roleMenus, type RoleMenuItem } from '@/router/roleMenus';
import { roleLabelMap } from '@/utils/statusMap';
import NotificationBell from '@/components/notification/NotificationBell';

export default function RoleBasedLayout() {
  const { message } = App.useApp();
  const [collapsed, setCollapsed] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const fetchWorkOrders = useWorkOrderStore((state) => state.fetchWorkOrders);
  const resetNotifications = useNotificationStore((state) => state.reset);
  const resetReports = useReportStore((state) => state.resetReports);
  const navigate = useNavigate();
  const location = useLocation();

  const menus = useMemo(() => (user && isValidRole(user.role) ? roleMenus[user.role] : []), [user]);
  const selectedKey = user && isValidRole(user.role) ? findMenuKey(location.pathname, user.role) : undefined;

  useEffect(() => {
    if (user) void fetchWorkOrders({ page: 1, pageSize: 100 }).catch(() => undefined);
  }, [fetchWorkOrders, user]);

  if (!user || !isValidRole(user.role)) {
    return null;
  }

  const toMenuItems = (items: RoleMenuItem[]): any[] =>
    items.map((item) => ({
      key: item.path,
      icon: item.icon,
      label: item.label,
      children: item.children ? toMenuItems(item.children) : undefined,
    }));

  return (
    <Layout className="app-shell">
      <Layout.Sider
        width={236}
        collapsedWidth={0}
        breakpoint="lg"
        collapsed={collapsed}
        onBreakpoint={setCollapsed}
        trigger={null}
        className="app-sider"
      >
        <div className="brand">
          <div className="brand-mark">审</div>
          {!collapsed ? (
            <div>
              <div className="brand-name">财务运营系统</div>
              <div className="brand-subtitle">物流企业审核平台</div>
            </div>
          ) : null}
        </div>
        <Menu
          mode="inline"
          className="side-menu"
          selectedKeys={[selectedKey ?? getDefaultPath(user.role)]}
          defaultOpenKeys={['/data', '/boss/data']}
          onClick={({ key }) => {
            const target = String(key);
            if (target !== '/data' && target !== '/boss/data') {
              navigate(target);
            }
          }}
          items={toMenuItems(menus)}
        />
      </Layout.Sider>

      <Layout>
        <Layout.Header className="app-header">
          <Space size={12}>
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed((value) => !value)}
              aria-label="切换菜单"
            />
            <Typography.Text className="header-title">物流企业 AI 财务运营系统</Typography.Text>
          </Space>
          <Space size={12}>
            <NotificationBell />
            <Avatar style={{ background: user.avatarColor }} icon={<UserOutlined />}>
              {user.name.slice(0, 1)}
            </Avatar>
            <Typography.Text className="header-user-name">{user.name}</Typography.Text>
            <Tag className="header-role-tag" color="blue">{roleLabelMap[user.role]}</Tag>
            <Button
              className="header-logout"
              icon={<LogoutOutlined />}
              loading={loggingOut}
              onClick={async () => {
                setLoggingOut(true);
                try {
                  await logout();
                } catch (error) {
                  message.warning(error instanceof Error ? error.message : '退出请求失败，本地会话已清理');
                } finally {
                  resetNotifications();
                  resetReports();
                  setLoggingOut(false);
                  navigate('/login', { replace: true });
                }
              }}
            >
              退出
            </Button>
          </Space>
        </Layout.Header>
        <Layout.Content className="app-content">
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
