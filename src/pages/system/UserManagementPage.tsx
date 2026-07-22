import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  KeyOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { Alert, App, Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import { useAuthStore } from '@/store/authStore';
import { useUserStore } from '@/store/userStore';
import type { Role } from '@/types/auth';
import type { CreateUserPayload, UpdateUserPayload, UserAccount } from '@/types/user';
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
  const { users, page, pageSize, total, loading, error } = useUserStore();
  const fetchUsers = useUserStore((state) => state.fetchUsers);
  const createUser = useUserStore((state) => state.createUser);
  const updateUser = useUserStore((state) => state.updateUser);
  const resetPassword = useUserStore((state) => state.resetPassword);
  const updateStatus = useUserStore((state) => state.updateStatus);
  const deleteUser = useUserStore((state) => state.deleteUser);
  const [keyword, setKeyword] = useState('');
  const [operation, setOperation] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<UserAccount | null>(null);
  const [resetting, setResetting] = useState<UserAccount | null>(null);
  const [createForm] = Form.useForm<CreateUserPayload>();
  const [editForm] = Form.useForm<UpdateUserPayload>();
  const [resetForm] = Form.useForm<ResetFormValues>();

  useEffect(() => {
    void fetchUsers({ page: 1, pageSize: 20 }).catch(() => undefined);
  }, [fetchUsers]);

  const availableRoleOptions = useMemo(
    () => (currentUser?.role === 'finance' ? roleOptions.filter((option) => option.value !== 'boss') : roleOptions),
    [currentUser?.role],
  );

  const canManage = (record: UserAccount) => currentUser?.role === 'boss' || record.role !== 'boss';

  const openEdit = (record: UserAccount) => {
    setEditing(record);
    editForm.setFieldsValue({
      username: record.username,
      name: record.name,
      role: record.role,
      department: record.department,
      phone: record.phone,
    });
  };

  const submitCreate = async () => {
    try {
      const values = await createForm.validateFields();
      setOperation('create');
      await createUser(values);
      message.success('新增员工成功');
      createForm.resetFields();
      setCreateOpen(false);
    } catch (error) {
      if (error instanceof Error) message.error(error.message);
    } finally {
      setOperation(null);
    }
  };

  const submitEdit = async () => {
    if (!editing) return;
    try {
      const values = await editForm.validateFields();
      setOperation(`edit:${editing.id}`);
      await updateUser(editing.id, values);
      message.success('员工信息已更新');
      setEditing(null);
      editForm.resetFields();
    } catch (error) {
      if (error instanceof Error) message.error(error.message);
    } finally {
      setOperation(null);
    }
  };

  const submitResetPassword = async () => {
    if (!resetting) return;
    try {
      const values = await resetForm.validateFields();
      if (values.password !== values.confirmPassword) {
        message.warning('两次输入的密码不一致');
        return;
      }
      setOperation(`password:${resetting.id}`);
      await resetPassword(resetting.id, values.password);
      message.success('密码已重置，旧会话已失效');
      setResetting(null);
      resetForm.resetFields();
    } catch (error) {
      if (error instanceof Error) message.error(error.message);
    } finally {
      setOperation(null);
    }
  };

  const toggleStatus = async (record: UserAccount) => {
    const nextStatus = record.status === 'active' ? 'disabled' : 'active';
    try {
      setOperation(`status:${record.id}`);
      await updateStatus(record.id, nextStatus);
      message.success(nextStatus === 'active' ? '账号已启用' : '账号已停用');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '更新状态失败');
    } finally {
      setOperation(null);
    }
  };

  const removeUser = async (record: UserAccount) => {
    try {
      setOperation(`delete:${record.id}`);
      await deleteUser(record.id);
      message.success('账号已软删除并停用');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除失败');
    } finally {
      setOperation(null);
    }
  };

  const columns: ColumnsType<UserAccount> = [
    { title: '姓名', dataIndex: 'name' },
    { title: '登录账号', dataIndex: 'username' },
    { title: '角色', dataIndex: 'role', render: (value: Role) => roleLabelMap[value] },
    { title: '部门', dataIndex: 'department', render: (value: string) => value || '-' },
    { title: '手机号', dataIndex: 'phone', render: (value: string) => value || '-' },
    {
      title: '状态',
      dataIndex: 'status',
      render: (value: UserAccount['status']) => <Tag color={statusMap[value].color}>{statusMap[value].label}</Tag>,
    },
    { title: '创建时间', dataIndex: 'createdAt', render: (value: string) => new Date(value).toLocaleString('zh-CN') },
    {
      title: '操作',
      width: 330,
      fixed: 'right',
      render: (_, record) => {
        if (readOnly) return null;
        const manageable = canManage(record);
        const reason = manageable ? undefined : '财务角色不能操作老板账号';
        return (
          <Tooltip title={reason}>
            <Space wrap>
              <Button type="link" icon={<EditOutlined />} disabled={!manageable} onClick={() => openEdit(record)}>
                编辑
              </Button>
              <Button type="link" icon={<KeyOutlined />} disabled={!manageable} onClick={() => setResetting(record)}>
                重置密码
              </Button>
              <Button
                type="link"
                danger={record.status === 'active'}
                icon={record.status === 'active' ? <StopOutlined /> : <CheckCircleOutlined />}
                disabled={!manageable}
                loading={operation === `status:${record.id}`}
                onClick={() => void toggleStatus(record)}
              >
                {record.status === 'active' ? '停用' : '启用'}
              </Button>
              <Popconfirm
                title="软删除账号"
                description="账号会被停用，历史审计记录将保留。"
                okText="确认"
                cancelText="取消"
                disabled={!manageable}
                onConfirm={() => removeUser(record)}
              >
                <Button
                  type="link"
                  danger
                  icon={<DeleteOutlined />}
                  disabled={!manageable}
                  loading={operation === `delete:${record.id}`}
                >
                  删除
                </Button>
              </Popconfirm>
            </Space>
          </Tooltip>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="员工管理"
        description="创建和管理员工账号，分配系统角色。"
        extra={!readOnly ? <Button type="primary" onClick={() => setCreateOpen(true)}>新增员工</Button> : null}
      />
      {error ? <Alert type="error" showIcon message="用户数据加载失败" description={error} style={{ marginBottom: 16 }} /> : null}
      <Card>
        <Input.Search
          allowClear
          value={keyword}
          placeholder="搜索姓名、账号、部门或手机号"
          style={{ width: 360, maxWidth: '100%', marginBottom: 16 }}
          onChange={(event) => setKeyword(event.target.value)}
          onSearch={(value) => void fetchUsers({ page: 1, pageSize, keyword: value }).catch(() => undefined)}
        />
        <Table
          rowKey="id"
          columns={columns}
          dataSource={users}
          loading={loading}
          scroll={{ x: 1200 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (count) => `共 ${count} 条`,
            onChange: (nextPage, nextPageSize) =>
              void fetchUsers({ page: nextPage, pageSize: nextPageSize, keyword }).catch(() => undefined),
          }}
        />
      </Card>

      <Modal
        title="新增员工"
        open={createOpen}
        confirmLoading={operation === 'create'}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void submitCreate()}
      >
        <Form form={createForm} layout="vertical">
          <Form.Item label="姓名" name="name" rules={[{ required: true, message: '请输入姓名' }]}><Input maxLength={100} /></Form.Item>
          <Form.Item label="登录账号" name="username" rules={[{ required: true, message: '请输入登录账号' }]}><Input maxLength={50} /></Form.Item>
          <Form.Item label="初始密码" name="password" rules={[{ required: true }, { min: 6, message: '密码至少 6 位' }]}><Input.Password maxLength={128} /></Form.Item>
          <Form.Item label="角色" name="role" rules={[{ required: true, message: '请选择角色' }]}><Select options={availableRoleOptions} /></Form.Item>
          <Form.Item label="部门" name="department"><Input maxLength={100} /></Form.Item>
          <Form.Item label="手机号" name="phone"><Input maxLength={30} /></Form.Item>
        </Form>
      </Modal>

      <Modal
        title="编辑员工"
        open={Boolean(editing)}
        confirmLoading={operation === `edit:${editing?.id}`}
        onCancel={() => setEditing(null)}
        onOk={() => void submitEdit()}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item label="姓名" name="name" rules={[{ required: true, message: '请输入姓名' }]}><Input maxLength={100} /></Form.Item>
          <Form.Item label="登录账号" name="username" rules={[{ required: true, message: '请输入登录账号' }]}><Input maxLength={50} /></Form.Item>
          <Form.Item label="角色" name="role" rules={[{ required: true, message: '请选择角色' }]}><Select options={availableRoleOptions} /></Form.Item>
          <Form.Item label="部门" name="department"><Input maxLength={100} /></Form.Item>
          <Form.Item label="手机号" name="phone"><Input maxLength={30} /></Form.Item>
        </Form>
      </Modal>

      <Modal
        title="重置密码"
        open={Boolean(resetting)}
        confirmLoading={operation === `password:${resetting?.id}`}
        onCancel={() => setResetting(null)}
        onOk={() => void submitResetPassword()}
      >
        <Form form={resetForm} layout="vertical">
          <Form.Item label="新密码" name="password" rules={[{ required: true }, { min: 6, message: '密码至少 6 位' }]}><Input.Password maxLength={128} /></Form.Item>
          <Form.Item label="确认密码" name="confirmPassword" dependencies={['password']} rules={[{ required: true, message: '请再次输入新密码' }]}><Input.Password maxLength={128} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
