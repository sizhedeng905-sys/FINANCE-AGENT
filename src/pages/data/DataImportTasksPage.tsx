import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, App, Button, Card, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import { useImportStore } from '@/store/importStore';
import type { ImportTask } from '@/types/dataCenter';
import { importStatusMap } from '@/utils/dataCenterMaps';

export default function DataImportTasksPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const tasks = useImportStore((state) => state.tasks);
  const page = useImportStore((state) => state.page);
  const pageSize = useImportStore((state) => state.pageSize);
  const total = useImportStore((state) => state.total);
  const loading = useImportStore((state) => state.loading);
  const error = useImportStore((state) => state.error);
  const fetchTasks = useImportStore((state) => state.fetchTasks);
  const parseTask = useImportStore((state) => state.parseTask);
  const cancelTask = useImportStore((state) => state.cancelTask);

  useEffect(() => {
    void fetchTasks().catch(() => undefined);
  }, [fetchTasks]);

  const columns: ColumnsType<ImportTask> = [
    { title: '文件名', dataIndex: 'fileName' },
    { title: '项目', dataIndex: 'projectName' },
    { title: '模板', dataIndex: 'templateName' },
    { title: '上传人', dataIndex: 'uploadedBy' },
    { title: '状态', dataIndex: 'status', render: (value) => <Tag>{importStatusMap[value as ImportTask['status']]}</Tag> },
    { title: '导入/错误', render: (_, task) => `${task.counts.imported} / ${task.counts.errors}` },
    { title: '创建时间', dataIndex: 'createdAt', render: (value: string) => new Date(value).toLocaleString('zh-CN') },
    {
      title: '操作',
      width: 320,
      render: (_, task) => (
        <Space wrap>
          {task.status === 'uploaded' ? (
            <Button type="link" onClick={() => void parseTask(task.id).then(() => navigate(`/data/import/${task.id}/mapping`)).catch((nextError) => message.error(nextError instanceof Error ? nextError.message : '解析失败'))}>解析</Button>
          ) : null}
          {['parsed', 'mapping'].includes(task.status) ? <Button type="link" onClick={() => navigate(`/data/import/${task.id}/mapping`)}>继续映射</Button> : null}
          {['pending_confirm', 'confirmed'].includes(task.status) ? <Button type="link" onClick={() => navigate(`/data/import/${task.id}/confirm`)}>查看确认</Button> : null}
          {!['confirmed', 'failed'].includes(task.status) ? (
            <Button type="link" danger onClick={() => void cancelTask(task.id).then(() => message.success('任务已取消')).catch((nextError) => message.error(nextError instanceof Error ? nextError.message : '取消失败'))}>取消</Button>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="导入任务" description="Excel 导入任务与结果" />
      {error ? <Alert type="error" showIcon message="导入任务加载失败" description={error} /> : null}
      <Card>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={tasks}
          loading={loading}
          scroll={{ x: 1100 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (count) => `共 ${count} 个任务`,
            onChange: (nextPage, nextPageSize) => void fetchTasks({ page: nextPage, pageSize: nextPageSize }),
          }}
        />
      </Card>
    </div>
  );
}
