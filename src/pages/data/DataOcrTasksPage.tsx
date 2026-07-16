import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, App, Button, Card, Popconfirm, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import { useOCRStore } from '@/store/ocrStore';
import type { OCRTask } from '@/types/dataCenter';
import { ocrStatusMap } from '@/utils/dataCenterMaps';

export default function DataOcrTasksPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const tasks = useOCRStore((state) => state.tasks);
  const page = useOCRStore((state) => state.page);
  const pageSize = useOCRStore((state) => state.pageSize);
  const total = useOCRStore((state) => state.total);
  const loading = useOCRStore((state) => state.loading);
  const error = useOCRStore((state) => state.error);
  const fetchTasks = useOCRStore((state) => state.fetchTasks);
  const runTask = useOCRStore((state) => state.runTask);
  const retryTask = useOCRStore((state) => state.retryTask);
  const cancelTask = useOCRStore((state) => state.cancelTask);

  useEffect(() => {
    void fetchTasks().catch(() => undefined);
  }, [fetchTasks]);

  useEffect(() => {
    if (!tasks.some((task) => ['queued', 'processing'].includes(task.status))) return undefined;
    const timer = window.setInterval(() => void fetchTasks({ page, pageSize }).catch(() => undefined), 2000);
    return () => window.clearInterval(timer);
  }, [fetchTasks, page, pageSize, tasks]);

  const columns: ColumnsType<OCRTask> = [
    { title: '文件名', render: (_, task) => task.rawFile.fileName },
    { title: '项目', dataIndex: 'projectName' },
    { title: '模板', dataIndex: 'templateName' },
    { title: 'Provider', render: (_, task) => `${task.provider} / ${task.modelName}` },
    { title: '状态', dataIndex: 'status', render: (value) => <Tag color={value === 'failed' ? 'error' : value === 'confirmed' ? 'success' : 'default'}>{ocrStatusMap[value as OCRTask['status']]}</Tag> },
    { title: '页数/尝试', render: (_, task) => `${task.pageCount} / ${task.attemptCount}` },
    { title: '创建时间', dataIndex: 'createdAt', render: (value: string) => new Date(value).toLocaleString('zh-CN') },
    {
      title: '操作',
      width: 300,
      render: (_, task) => (
        <Space wrap>
          <Button type="link" onClick={() => navigate(`/data/ocr/${task.id}`)}>查看</Button>
          {task.status === 'uploaded' || task.status === 'queued' ? (
            <Button type="link" loading={loading} onClick={() => void runTask(task.id).then(() => navigate(`/data/ocr/${task.id}`)).catch((nextError) => message.error(nextError instanceof Error ? nextError.message : '识别失败'))}>识别</Button>
          ) : null}
          {task.status === 'failed' ? (
            <Button type="link" loading={loading} onClick={() => void retryTask(task.id).then(() => navigate(`/data/ocr/${task.id}`)).catch((nextError) => message.error(nextError instanceof Error ? nextError.message : '重试失败'))}>重试</Button>
          ) : null}
          {!['confirmed', 'cancelled'].includes(task.status) ? (
            <Popconfirm title="确认取消该 OCR 任务？" onConfirm={() => void cancelTask(task.id).then(() => message.success('任务已取消')).catch((nextError) => message.error(nextError instanceof Error ? nextError.message : '取消失败'))}>
              <Button type="link" danger>取消</Button>
            </Popconfirm>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="OCR任务" description="识别、纠错与确认状态" extra={<Button type="primary" onClick={() => navigate('/data/ocr')}>新建识别</Button>} />
      {error ? <Alert type="error" showIcon message="OCR 任务加载失败" description={error} /> : null}
      <Card>
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={tasks}
          scroll={{ x: 1200 }}
          pagination={{ current: page, pageSize, total, showSizeChanger: true, onChange: (nextPage, nextPageSize) => void fetchTasks({ page: nextPage, pageSize: nextPageSize }).catch(() => undefined) }}
        />
      </Card>
    </div>
  );
}
