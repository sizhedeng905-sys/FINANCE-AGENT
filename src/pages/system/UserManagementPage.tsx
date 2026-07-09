import { useState } from 'react';
import { App, Button, Card, Form, Input, Modal, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import { useAuthStore } from '@/store/authStore';
import { useUserStore, type CreateUserPayload } from '@/store/userStore';
import type { Role } from '@/types/auth';
import type { UserAccount } from '@/types/user';
import { roleLabelMap } from '@/utils/statusMap';

interface ResetFormValues {
  password: string;
  confirmPassword: string;
}

const roleOptions: Array<{ label: string; value: Role }> = [
  { label: '员工', value: 'employee' },
  { label: '财务', value: 'finance' },
  { label: '复核员', value: 'reviewer' },
  { label: '老板', value: 'boss' },
];

const statusMap: Record<UserAccount['status'], { label: string; color: string }> = {
  active: { label: '启用', color: 'success' },
  disabled: { label: '停用', color: 'default' },
};

export default function UserManagementPage({ readOnly = false }: { readOnly?: boolean }) {
  const { message } = App.useApp();
  const currentUser = useAuthStore((state) => state.user);
  const users = useUserStore((state) => state.users);
  const createUser = useUserStore((state) => state.createUser);
  const updateUser = useUserStore((state) => state.updateUser);
  const resetPassword = useUserStore((state) => state.resetPassword);
  const disableUser = useUserStore((state) => state.disableUser);
  const enableUser = useUserStore((state) => state.enableUser);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<UserAccount | null>(null);
  const [resetting, setResetting] = useState<UserAccount | null>(null);
  const [createForm] = Form.useForm<CreateUserPayload>();
  const [editForm] = Form.useForm<Partial<UserAccount>>();
  const [resetForm] = Form.useForm<ResetFormValues>();

  const openEdit = (record: UserAccount) => {
    setEditing(record);
    editForm.setFieldsValue(record);
  };

  const submitCreate = () => {
    createForm.validateFields().then((values) => {
      try {
        createUser({ ...values, createdBy: currentUser?.name ?? '当前用户' });
        message.success('新增员工成功。');
        createForm.resetFields();
        setCreateOpen(false);
      } catch (error) {
        message.error(error instanceof Error ? error.message : '新增失败');
      }
    });
  };

  const submitEdit = () => {
    if (!editing) return;
    editForm.validateFields().then((values) => {
      updateUser(editing.id, values);
      message.success('员工信息已更新。');
      setEditing(null);
      editForm.resetFields();
    });
  };

  const submitResetPassword = () => {
    if (!resetting) return;
    resetForm.validateFields().then((values) => {
      if (values.password !== values.confirmPassword) {
        message.warning('两次输入的密码不一致');
        return;
      }
      try {
        resetPassword(resetting.id, values.password);
        message.success('密码已重置。');
        setResetting(null);
        resetForm.resetFields();
      } catch (error) {
        message.error(error instanceof Error ? error.message : '重置失败');
      }
    });
  };

  const toggleStatus = (record: UserAccount) => {
    if (record.status === 'active') {
      disableUser(record.id);
      message.success('账号已停用。');
    } else {
      enableUser(record.id);
      message.success('账号已启用。');
    }
  };

  const columns: ColumnsType<UserAccount> = [
    { title: '姓名', dataIndex: 'name' },
    { title: '登录账号', dataIndex: 'username' },
    { title: '角色', dataIndex: 'role', render: (value: Role) => roleLabelMap[value] },
    { title: '部门', dataIndex: 'department' },
    { title: '手机号', dataIndex: 'phone' },
    {
      title: '状态',
      dataIndex: 'status',
      render: (value: UserAccount['status']) => <Tag color={statusMap[value].color}>{statusMap[value].label}</Tag>,
    },
    { title: '创建时间', dataIndex: 'createdAt' },
    {
      title: '操作',
      render: (_, record) =>
        readOnly ? null : (
          <Space>
            <Button type="link" onClick={() => openEdit(record)}>编辑</Button>
            <Button type="link" onClick={() => setResetting(record)}>重置密码</Button>
            <Button type="link" danger={record.status === 'active'} onClick={() => toggleStatus(record)}>
              {record.status === 'active' ? '停用' : '启用'}
            </Button>
          </Space>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="员工管理"
        description="创建和管理员工账号，分配系统角色。"
        extra={!readOnly ? <Button type="primary" onClick={() => setCreateOpen(true)}>新增员工</Button> : null}
      />
      <Card>
        <Table rowKey="id" columns={columns} dataSource={users} scroll={{ x: 1000 }} />
      </Card>

      <Modal title="新增员工" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={submitCreate}>
        <Form form={createForm} layout="vertical">
          <Form.Item label="姓名" name="name" rules={[{ required: true, message: '请输入姓名' }]}><Input /></Form.Item>
          <Form.Item label="登录账号" name="username" rules={[{ required: true, message: '请输入登录账号' }]}><Input /></Form.Item>
          <Form.Item label="初始密码" name="password" rules={[{ required: true, message: '请输入初始密码' }]}><Input.Password /></Form.Item>
          <Form.Item label="角色" name="role" rules={[{ required: true, message: '请选择角色' }]}><Select options={roleOptions} /></Form.Item>
          <Form.Item label="部门" name="department"><Input /></Form.Item>
          <Form.Item label="手机号" name="phone"><Input /></Form.Item>
        </Form>
      </Modal>

      <Modal title="编辑员工" open={Boolean(editing)} onCancel={() => setEditing(null)} onOk={submitEdit}>
        <Form form={editForm} layout="vertical">
          <Form.Item label="姓名" name="name" rules={[{ required: true, message: '请输入姓名' }]}><Input /></Form.Item>
          <Form.Item label="角色" name="role" rules={[{ required: true, message: '请选择角色' }]}><Select options={roleOptions} /></Form.Item>
          <Form.Item label="部门" name="department"><Input /></Form.Item>
          <Form.Item label="手机号" name="phone"><Input /></Form.Item>
          <Form.Item label="状态" name="status"><Select options={[{ label: '启用', value: 'active' }, { label: '停用', value: 'disabled' }]} /></Form.Item>
        </Form>
      </Modal>

      <Modal title="重置密码" open={Boolean(resetting)} onCancel={() => setResetting(null)} onOk={submitResetPassword}>
        <Form form={resetForm} layout="vertical">
          <Form.Item label="新密码" name="password" rules={[{ required: true, message: '请输入新密码' }]}><Input.Password /></Form.Item>
          <Form.Item label="确认密码" name="confirmPassword" rules={[{ required: true, message: '请再次输入新密码' }]}><Input.Password /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
