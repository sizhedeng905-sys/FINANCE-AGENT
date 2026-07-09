import type { ReactNode } from 'react';
import { Space, Typography } from 'antd';

interface PageHeaderProps {
  title: string;
  description?: string;
  extra?: ReactNode;
}

export default function PageHeader({ title, description, extra }: PageHeaderProps) {
  return (
    <div className="page-header">
      <div>
        <Typography.Title level={3} className="page-title">
          {title}
        </Typography.Title>
        {description ? <Typography.Text type="secondary">{description}</Typography.Text> : null}
      </div>
      {extra ? <Space>{extra}</Space> : null}
    </div>
  );
}
