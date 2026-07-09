import { Button, Result } from 'antd';
import { useNavigate } from 'react-router-dom';

export default function ForbiddenPage() {
  const navigate = useNavigate();
  return (
    <Result
      status="403"
      title="403"
      subTitle="当前账号没有访问该页面的权限。"
      extra={<Button onClick={() => navigate(-1)}>返回</Button>}
    />
  );
}
