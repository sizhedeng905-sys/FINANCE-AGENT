import { useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, App, Button, Card, Col, Empty, Progress, Row, Space, Spin, Statistic, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import { useImportStore } from '@/store/importStore';
import type { ImportPreviewRow } from '@/types/dataCenter';
import { formatMoney } from '@/utils/format';

export default function DataImportConfirmPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const preview = useImportStore((state) => state.preview?.task.id === id ? state.preview : undefined);
  const currentTask = useImportStore((state) => state.currentTask?.id === id ? state.currentTask : undefined);
  const loading = useImportStore((state) => state.loading);
  const error = useImportStore((state) => state.error);
  const fetchPreview = useImportStore((state) => state.fetchPreview);
  const fetchTask = useImportStore((state) => state.fetchTask);
  const confirmTask = useImportStore((state) => state.confirmTask);
  const task = currentTask ?? preview?.task;
  const followConfirmation = useRef(false);

  useEffect(() => {
    if (id) void fetchPreview(id).catch(() => undefined);
  }, [fetchPreview, id]);

  useEffect(() => {
    if (!id || task?.status !== 'confirming') return;
    followConfirmation.current = true;
    let stopped = false;
    let polling = false;
    const refresh = async () => {
      if (polling || stopped) return;
      polling = true;
      try {
        await fetchTask(id);
      } catch {
        // Store exposes the request error; the next poll can recover from a short disconnect.
      } finally {
        polling = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [fetchTask, id, task?.status]);

  useEffect(() => {
    if (!followConfirmation.current) return;
    if (task?.status === 'confirmed') {
      followConfirmation.current = false;
      message.success(`导入完成，共生成 ${task.counts.imported} 条经营记录`);
      navigate('/data/records');
    } else if (task?.status === 'confirmation_failed') {
      followConfirmation.current = false;
      message.error(task.errorMessage || '后台确认失败，已保存进度，可重试');
    }
  }, [message, navigate, task]);

  const columns: ColumnsType<ImportPreviewRow> = [
    { title: '行号', dataIndex: 'rowNumber', width: 80 },
    { title: '日期', dataIndex: 'recordDate', render: (value) => value || '-' },
    { title: '金额', dataIndex: 'amount', render: (value) => value === undefined ? '-' : formatMoney(value) },
    { title: '分类', dataIndex: 'category' },
    {
      title: '动态字段',
      render: (_, row) => (
        <Space wrap>{row.values.map((value) => <Tag key={value.fieldId}>{value.fieldName}：{String(value.value)}</Tag>)}</Space>
      ),
    },
    {
      title: '校验结果',
      render: (_, row) => (
        <Space direction="vertical" size={2}>
          {row.errors.map((item) => <Tag color="error" key={item}>{item}</Tag>)}
          {row.warnings.map((item) => <Tag color="warning" key={item}>{item}</Tag>)}
          {!row.errors.length && row.status === 'mapped' ? <Tag color="success">可入库</Tag> : null}
          {row.status === 'duplicate' ? <Tag>重复行</Tag> : null}
          {row.status === 'ignored' ? <Tag>已忽略</Tag> : null}
          {row.status === 'confirmed' ? <Tag color="success">已入库</Tag> : null}
        </Space>
      ),
    },
  ];

  const confirm = async () => {
    if (!id) return;
    const result = await confirmTask(id);
    if (result.task.status === 'confirmed') {
      message.success('该任务已确认，本次未重复生成记录');
      navigate('/data/records');
      return;
    }
    message.info('任务已进入后台确认，完成后将自动打开数据记录');
  };

  return (
    <div>
      <PageHeader title="导入确认" description="合法行入库，错误行保留" />
      {error ? <Alert type="error" showIcon message="导入预览失败" description={error} /> : null}
      <Spin spinning={loading && !preview}>
        {!preview && !loading ? <Card><Empty description="暂无导入预览" /></Card> : null}
        {preview ? (
          <>
            {preview.unresolvedColumns.length ? (
              <Alert
                type="warning"
                showIcon
                message="仍有未处理列"
                description={preview.unresolvedColumns.map((item) => item.sourceName).join('、')}
              />
            ) : null}
            {task?.status === 'confirming' ? (
              <Alert
                type="info"
                showIcon
                message="正在后台确认入库"
                description={(
                  <Progress
                    percent={task.confirmationProgress?.percent ?? 0}
                    format={() => `${task.confirmationProgress?.processed ?? 0} / ${task.confirmationProgress?.total ?? preview.summary.total}`}
                  />
                )}
              />
            ) : null}
            {task?.status === 'confirmation_failed' ? (
              <Alert
                type="error"
                showIcon
                message="后台确认未完成"
                description={task.errorMessage || '已保存已处理批次，可从当前进度安全重试'}
              />
            ) : null}
            <Row gutter={[16, 16]} className="section-row">
              <Col xs={12} md={4}><Card><Statistic title="总行数" value={preview.summary.total} /></Card></Col>
              <Col xs={12} md={4}><Card><Statistic title="可入库" value={preview.summary.valid} valueStyle={{ color: '#16a34a' }} /></Card></Col>
              <Col xs={12} md={4}><Card><Statistic title="错误行" value={preview.summary.errors} valueStyle={{ color: '#dc2626' }} /></Card></Col>
              <Col xs={12} md={4}><Card><Statistic title="重复行" value={preview.summary.duplicates} /></Card></Col>
              <Col xs={12} md={4}><Card><Statistic title="空/忽略行" value={preview.summary.ignored} /></Card></Col>
            </Row>
            <Card>
              <Table rowKey="id" columns={columns} dataSource={preview.rows} pagination={{ pageSize: 20 }} scroll={{ x: 1100 }} />
              <Space className="form-actions" wrap>
                <Button
                  disabled={task?.status === 'confirming' || task?.status === 'confirmed' || task?.status === 'confirmation_failed'}
                  onClick={() => navigate(`/data/import/${id}/mapping`)}
                >
                  返回修改映射
                </Button>
                <Button
                  type="primary"
                  loading={loading && task?.status !== 'confirming'}
                  disabled={preview.unresolvedColumns.length > 0 || preview.summary.valid === 0 || task?.status === 'confirmed' || task?.status === 'confirming'}
                  onClick={() => void confirm().catch((nextError) => message.error(nextError instanceof Error ? nextError.message : '确认失败'))}
                >
                  {task?.status === 'confirmation_failed' ? '重试确认' : '确认导入合法行'}
                </Button>
                {task?.status === 'confirmed' ? <Button onClick={() => navigate('/data/records')}>查看数据记录</Button> : null}
              </Space>
            </Card>
          </>
        ) : null}
      </Spin>
    </div>
  );
}
