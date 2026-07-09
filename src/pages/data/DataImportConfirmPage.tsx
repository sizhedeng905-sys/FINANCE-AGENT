import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { App, Button, Card, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import { useDataCenterStore } from '@/store/dataCenterStore';
import type { ImportRow } from '@/types/dataCenter';

export default function DataImportConfirmPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const importRows = useDataCenterStore((state) => state.importRows);
  const confirmImportTask = useDataCenterStore((state) => state.confirmImportTask);

  const rows = useMemo(() => importRows.filter((item) => item.importTaskId === id), [id, importRows]);
  const data = rows.length ? rows : importRows.slice(0, 2).map((item) => ({ ...item, importTaskId: id ?? '' }));
  const columns: ColumnsType<ImportRow> = [
    { title: '行号', dataIndex: 'rowNumber' },
    { title: '日期', render: (_, record) => String(record.mappedData['日期'] ?? record.rawData['日期'] ?? '-') },
    { title: '金额', render: (_, record) => String(record.mappedData['金额'] ?? record.rawData['金额'] ?? '-') },
    { title: '分类', render: () => '导入数据' },
    { title: '映射结果', render: (_, record) => Object.keys(record.mappedData).join('、') || '待映射' },
    { title: '状态', dataIndex: 'status', render: (value) => <Tag>{value}</Tag> },
    { title: '错误信息', dataIndex: 'errorMessage', render: (value) => value || '-' },
  ];

  return (
    <div>
      <PageHeader title="导入确认" description="确认解析出来的记录，确认后进入 BusinessRecord" />
      <Card>
        <Table rowKey="id" columns={columns} dataSource={data} scroll={{ x: 900 }} />
        <Space className="form-actions">
          <Button onClick={() => navigate(`/data/import/${id}/mapping`)}>返回修改映射</Button>
          <Button onClick={() => message.success('单行已确认')}>单行确认</Button>
          <Button
            type="primary"
            onClick={() => {
              if (id) confirmImportTask(id);
              message.success('全部确认，已生成 BusinessRecord');
              navigate('/data/records');
            }}
          >
            全部确认
          </Button>
        </Space>
      </Card>
    </div>
  );
}
