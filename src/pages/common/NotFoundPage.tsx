import { Button, Result } from 'antd';
import { useNavigate } from 'react-router-dom';

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <Result
      status="404"
      title="404"
      subTitle="页面不存在。"
      extra={<Button onClick={() => navigate('/login')}>返回登录</Button>}
    />
  );
}
