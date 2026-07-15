import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, App, Button, Card, Col, Empty, Row, Space, Spin, Statistic, Table, Tag } from 'antd';
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
  const loading = useImportStore((state) => state.loading);
  const error = useImportStore((state) => state.error);
  const fetchPreview = useImportStore((state) => state.fetchPreview);
  const confirmTask = useImportStore((state) => state.confirmTask);

  useEffect(() => {
    if (id) void fetchPreview(id).catch(() => undefined);
  }, [fetchPreview, id]);

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
    message.success(result.alreadyConfirmed
      ? '该任务已确认，本次未重复生成记录'
      : `已导入 ${result.importedRows} 行，保留 ${result.errorRows} 行错误数据`);
    navigate('/data/records');
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
                <Button onClick={() => navigate(`/data/import/${id}/mapping`)}>返回修改映射</Button>
                <Button
                  type="primary"
                  loading={loading}
                  disabled={preview.unresolvedColumns.length > 0 || preview.summary.valid === 0 || preview.task.status === 'confirmed'}
                  onClick={() => void confirm().catch((nextError) => message.error(nextError instanceof Error ? nextError.message : '确认失败'))}
                >
                  确认导入合法行
                </Button>
                {preview.task.status === 'confirmed' ? <Button onClick={() => navigate('/data/records')}>查看数据记录</Button> : null}
              </Space>
            </Card>
          </>
        ) : null}
      </Spin>
    </div>
  );
}
