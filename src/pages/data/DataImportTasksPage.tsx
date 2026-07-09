import { useNavigate } from 'react-router-dom';
import { App, Button, Card, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import { useDataCenterStore } from '@/store/dataCenterStore';
import type { ImportTask } from '@/types/dataCenter';
import { importStatusMap } from '@/utils/dataCenterMaps';

export default function DataImportTasksPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const importTasks = useDataCenterStore((state) => state.importTasks);
  const cancelImportTask = useDataCenterStore((state) => state.cancelImportTask);
  const columns: ColumnsType<ImportTask> = [
    { title: '任务ID', dataIndex: 'id' },
    { title: '文件名', dataIndex: 'fileName' },
    { title: '项目', dataIndex: 'projectName' },
    { title: '模板', dataIndex: 'templateName' },
    { title: '上传人', dataIndex: 'uploadedBy' },
    { title: '状态', dataIndex: 'status', render: (value) => <Tag>{importStatusMap[value as ImportTask['status']]}</Tag> },
    { title: '创建时间', dataIndex: 'createdAt' },
    {
      title: '操作',
      render: (_, record) => (
        <Space>
          <Button type="link" onClick={() => navigate(`/data/import/${record.id}/mapping`)}>继续映射</Button>
          <Button type="link" onClick={() => navigate(`/data/import/${record.id}/confirm`)}>查看确认结果</Button>
          {record.status !== 'confirmed' ? <Button type="link" danger onClick={() => { cancelImportTask(record.id); message.success('任务已取消'); }}>取消</Button> : null}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="导入任务" description="查看 Excel 导入任务状态和处理进度" />
      <Card>
        <Table rowKey="id" columns={columns} dataSource={importTasks} scroll={{ x: 1100 }} />
      </Card>
    </div>
  );
}
