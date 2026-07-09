import type { User } from '@/types/auth';

export const mockUsers: User[] = [
  {
    id: 'u-employee',
    username: 'employee',
    password: '123456',
    name: '陈明',
    role: 'employee',
    title: '项目负责人',
    department: '运营部',
    avatarColor: '#1677ff',
  },
  {
    id: 'u-finance',
    username: 'finance',
    password: '123456',
    name: '林雪',
    role: 'finance',
    title: '财务审核',
    department: '财务部',
    avatarColor: '#13c2c2',
  },
  {
    id: 'u-reviewer',
    username: 'reviewer',
    password: '123456',
    name: '赵复核',
    role: 'reviewer',
    title: '复核员',
    department: '内控部',
    avatarColor: '#fa8c16',
  },
  {
    id: 'u-boss',
    username: 'boss',
    password: '123456',
    name: '周总',
    role: 'boss',
    title: '总经理',
    department: '管理层',
    avatarColor: '#722ed1',
  },
];
