import { useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Avatar, Button, Layout, Menu, Space, Tag, Typography } from 'antd';
import { useAuthStore } from '@/store/authStore';
import { findMenuKey, getDefaultPath, isValidRole, roleMenus, type RoleMenuItem } from '@/router/roleMenus';
import { roleLabelMap } from '@/utils/statusMap';
import NotificationBell from '@/components/notification/NotificationBell';

export default function RoleBasedLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();
  const location = useLocation();

  const menus = useMemo(() => (user && isValidRole(user.role) ? roleMenus[user.role] : []), [user]);
  const selectedKey = user && isValidRole(user.role) ? findMenuKey(location.pathname, user.role) : undefined;

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
        collapsedWidth={72}
        collapsed={collapsed}
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
            <NotificationBell role={user.role} />
            <Avatar style={{ background: user.avatarColor }} icon={<UserOutlined />}>
              {user.name.slice(0, 1)}
            </Avatar>
            <Typography.Text>{user.name}</Typography.Text>
            <Tag color="blue">{roleLabelMap[user.role]}</Tag>
            <Button
              icon={<LogoutOutlined />}
              onClick={() => {
                logout();
                navigate('/login', { replace: true });
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
