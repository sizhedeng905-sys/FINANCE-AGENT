import type { ReactNode } from 'react';
import {
  AuditOutlined,
  CheckCircleOutlined,
  FileAddOutlined,
  FileDoneOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  HomeOutlined,
  MessageOutlined,
  UnorderedListOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { Role } from '@/types/auth';

export interface RoleMenuItem {
  path: string;
  label: string;
  icon: ReactNode;
  children?: RoleMenuItem[];
}

export const roleMenus: Record<Role, RoleMenuItem[]> = {
  employee: [
    { path: '/employee/home', label: '首页', icon: <HomeOutlined /> },
    { path: '/work-orders/create', label: '新建工单', icon: <FileAddOutlined /> },
    { path: '/work-orders/my', label: '我的工单', icon: <UnorderedListOutlined /> },
  ],
  finance: [
    { path: '/finance/home', label: '首页', icon: <HomeOutlined /> },
    { path: '/finance/audit', label: '财务审核', icon: <AuditOutlined /> },
    { path: '/finance/anomalies', label: 'AI异常提示', icon: <WarningOutlined /> },
    { path: '/finance/reports', label: '财务日报', icon: <FileTextOutlined /> },
    {
      path: '/data',
      label: '数据中心',
      icon: <FolderOpenOutlined />,
      children: [
        { path: '/data/projects', label: '项目管理', icon: <FolderOpenOutlined /> },
        { path: '/data/templates', label: '模板管理', icon: <FileDoneOutlined /> },
        { path: '/data/fields', label: '字段字典', icon: <UnorderedListOutlined /> },
        { path: '/data/manual-record', label: '手工补录', icon: <FileAddOutlined /> },
        { path: '/data/import', label: 'Excel导入', icon: <FileTextOutlined /> },
        { path: '/data/import-tasks', label: '导入任务', icon: <FileSearchOutlined /> },
        { path: '/data/records', label: '数据记录', icon: <AuditOutlined /> },
        { path: '/data/field-suggestions', label: '字段建议', icon: <WarningOutlined /> },
      ],
    },
  ],
  reviewer: [
    { path: '/reviewer/home', label: '首页', icon: <HomeOutlined /> },
    { path: '/reviewer/tasks', label: '复核任务', icon: <FileSearchOutlined /> },
    { path: '/reviewer/history', label: '审核历史', icon: <FileDoneOutlined /> },
  ],
  boss: [
    { path: '/boss/home', label: '首页', icon: <HomeOutlined /> },
    { path: '/boss/approval', label: '最终审批', icon: <CheckCircleOutlined /> },
    { path: '/boss/ai', label: 'AI助手', icon: <MessageOutlined /> },
    {
      path: '/boss/data',
      label: '数据查看',
      icon: <FolderOpenOutlined />,
      children: [
        { path: '/boss/data/projects', label: '项目概览', icon: <FolderOpenOutlined /> },
        { path: '/boss/data/records', label: '数据记录', icon: <AuditOutlined /> },
        { path: '/boss/reports', label: '经营日报', icon: <FileTextOutlined /> },
      ],
    },
  ],
};

export function isValidRole(role?: string): role is Role {
  return role === 'employee' || role === 'finance' || role === 'reviewer' || role === 'boss';
}

export function getDefaultPath(role?: string) {
  if (!isValidRole(role)) {
    return '/login';
  }

  return roleMenus[role][0].path;
}

function flattenMenus(items: RoleMenuItem[]): RoleMenuItem[] {
  return items.flatMap((item) => (item.children ? [item, ...flattenMenus(item.children)] : [item]));
}

export function canAccess(pathname: string, role?: string) {
  if (!isValidRole(role)) return false;

  if (pathname === '/' || pathname === '/login') return true;

  if (/^\/work-orders\/[^/]+$/.test(pathname)) {
    return true;
  }

  if (role === 'employee') {
    return ['/employee/home', '/work-orders/create', '/work-orders/my'].includes(pathname);
  }

  if (role === 'finance') {
    return (
      ['/finance/home', '/finance/audit', '/finance/anomalies', '/finance/reports'].includes(pathname) ||
      pathname.startsWith('/data/')
    );
  }

  if (role === 'reviewer') {
    return (
      ['/reviewer/home', '/reviewer/tasks', '/reviewer/history'].includes(pathname) ||
      /^\/reviewer\/tasks\/[^/]+$/.test(pathname)
    );
  }

  if (role === 'boss') {
    return (
      ['/boss/home', '/boss/approval', '/boss/ai', '/boss/reports', '/boss/projects', '/boss/data/projects', '/boss/data/records'].includes(pathname) ||
      /^\/boss\/approval\/[^/]+$/.test(pathname)
    );
  }

  return false;
}

export function findMenuKey(pathname: string, role: Role) {
  const flat = flattenMenus(roleMenus[role]).filter((item) => !item.children);
  return flat
    .sort((a, b) => b.path.length - a.path.length)
    .find((item) => pathname.startsWith(item.path))?.path;
}
