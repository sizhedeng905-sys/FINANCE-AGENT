import { FileImageOutlined, FileTextOutlined } from '@ant-design/icons';
import { Empty, Space, Tag } from 'antd';

export default function AttachmentPreview({ attachments }: { attachments: string[] }) {
  if (!attachments.length) {
    return <Empty description="暂无附件" />;
  }

  return (
    <Space direction="vertical" className="full-width">
      {attachments.map((item) => (
        <div className="attachment-row" key={item}>
          {item.toLowerCase().match(/\.(jpg|png|jpeg)$/) ? <FileImageOutlined /> : <FileTextOutlined />}
          <span>{item}</span>
          <Tag color="blue">Mock 预览</Tag>
        </div>
      ))}
    </Space>
  );
}
