import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LoginOutlined, LockOutlined, UserOutlined } from '@ant-design/icons';
import { Alert, App, Button, Card, Form, Input, Segmented, Space, Typography } from 'antd';
import type { Role } from '@/types/auth';
import { useAuthStore } from '@/store/authStore';
import { getDefaultPath } from '@/router/roleMenus';
import { roleLabelMap } from '@/utils/statusMap';
import { clearAppStorage } from '@/utils/cache';
import { runtimeConfig } from '@/config/runtime';

const accounts: { label: string; value: Role; desc: string }[] = [
  { label: '员工', value: 'employee', desc: '提交工单、查看进度、催办' },
  { label: '财务', value: 'finance', desc: '财务审核、异常提示、日报' },
  { label: '复核员', value: 'reviewer', desc: '复核任务、审核历史' },
  { label: '老板', value: 'boss', desc: '最终审批、AI助手、经营日报' },
];

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [form] = Form.useForm<{ username: string; password: string }>();
  const { message } = App.useApp();
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();
  const showDemoAccounts = runtimeConfig.dataMode === 'mock';
  const username = Form.useWatch('username', form) ?? '';
  const selectedRole = accounts.find((item) => item.value === username)?.value;

  const submit = async (values: { username: string; password: string }) => {
    setLoading(true);
    setLoginError(null);
    try {
      const user = await login(values.username, values.password);
      message.success('登录成功');
      navigate(getDefaultPath(user.role), { replace: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '登录失败';
      setLoginError(errorMessage);
      message.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page audit-login">
      <section className="login-intro">
        <Typography.Title className="login-title">物流企业 AI 财务运营审核系统</Typography.Title>
        <Typography.Paragraph className="login-desc">
          员工提交工单，财务初审，复核员二次确认，AI 自动复核，老板最终审批。
        </Typography.Paragraph>
        <div className="login-metrics">
          <div>
            <strong>4</strong>
            <span>登录角色</span>
          </div>
          <div>
            <strong>6</strong>
            <span>审批步骤</span>
          </div>
          <div>
            <strong>{runtimeConfig.dataMode === 'api' ? 'API' : 'Mock'}</strong>
            <span>数据模式</span>
          </div>
        </div>
      </section>

      <Card className="login-card">
        <Space direction="vertical" size={4} className="login-card-head">
          <Typography.Title level={3}>账号登录</Typography.Title>
          {showDemoAccounts ? <Typography.Text type="secondary">演示环境测试账号</Typography.Text> : null}
        </Space>

        <Form
          form={form}
          layout="vertical"
          initialValues={showDemoAccounts ? { username: 'employee', password: '123456' } : undefined}
          onFinish={submit}
        >
          {loginError ? (
            <Alert type="error" showIcon message="登录失败" description={loginError} style={{ marginBottom: 16 }} />
          ) : null}
          {showDemoAccounts ? (
            <>
              <Form.Item label="测试账号">
                <Segmented
                  block
                  value={selectedRole}
                  onChange={(value) => form.setFieldsValue({ username: String(value), password: '123456' })}
                  options={accounts.map((item) => ({ label: item.label, value: item.value }))}
                />
              </Form.Item>
              <div className="account-hints">
                {accounts.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => form.setFieldsValue({ username: item.value, password: '123456' })}
                  >
                    <span>{item.label}</span>
                    <small>{item.desc}</small>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          <Form.Item label="登录账号" name="username" rules={[{ required: true, message: '请输入登录账号' }]}>
            <Input size="large" prefix={<UserOutlined />} placeholder="请输入登录账号，例如 employee" />
          </Form.Item>
          {selectedRole ? (
            <Typography.Text type="secondary">当前角色：{roleLabelMap[selectedRole]}</Typography.Text>
          ) : (
            <Typography.Text type="secondary">新增账号将按员工管理中配置的角色进入系统</Typography.Text>
          )}
          <Form.Item label="密码" name="password" rules={[{ required: true }]}>
            <Input.Password size="large" prefix={<LockOutlined />} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={loading} icon={<LoginOutlined />}>
            进入系统
          </Button>
          <Button
            type="link"
            block
            onClick={() => {
              clearAppStorage();
              window.location.href = '/login';
            }}
          >
            清空缓存并重新登录
          </Button>
        </Form>
      </Card>
    </div>
  );
}
