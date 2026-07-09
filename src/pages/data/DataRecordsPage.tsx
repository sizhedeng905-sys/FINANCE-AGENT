import { useMemo, useState } from 'react';
import { App, Button, Card, DatePicker, Descriptions, Drawer, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import { useDataCenterStore } from '@/store/dataCenterStore';
import type { BusinessRecord } from '@/types/dataCenter';
import { formatMoney } from '@/utils/format';
import { recordStatusMap, recordTypeMap, sourceTypeMap } from '@/utils/dataCenterMaps';

export default function DataRecordsPage({ readOnly = false }: { readOnly?: boolean }) {
  const { message } = App.useApp();
  const [selected, setSelected] = useState<BusinessRecord | null>(null);
  const [projectId, setProjectId] = useState<string>();
  const [recordType, setRecordType] = useState<string>();
  const [sourceType, setSourceType] = useState<string>();
  const [status, setStatus] = useState<string>();
  const projects = useDataCenterStore((state) => state.projects);
  const records = useDataCenterStore((state) => state.records);
  const confirmRecord = useDataCenterStore((state) => state.confirmRecord);
  const deleteRecord = useDataCenterStore((state) => state.deleteRecord);

  const data = useMemo(
    () =>
      records.filter((item) => {
        const matchProject = !projectId || item.projectId === projectId;
        const matchType = !recordType || item.recordType === recordType;
        const matchSource = !sourceType || item.sourceType === sourceType;
        const matchStatus = !status || item.status === status;
        return matchProject && matchType && matchSource && matchStatus;
      }),
    [projectId, recordType, records, sourceType, status],
  );

  const columns: ColumnsType<BusinessRecord> = [
    { title: '日期', dataIndex: 'recordDate' },
    { title: '项目', dataIndex: 'projectName' },
    { title: '类型', dataIndex: 'recordType', render: (value) => recordTypeMap[value as BusinessRecord['recordType']] },
    { title: '金额', dataIndex: 'amount', render: (value) => formatMoney(value) },
    { title: '分类', dataIndex: 'category' },
    { title: '来源', dataIndex: 'sourceType', render: (value) => sourceTypeMap[value as BusinessRecord['sourceType']] },
    { title: '状态', dataIndex: 'status', render: (value) => <Tag>{recordStatusMap[value as BusinessRecord['status']]}</Tag> },
    { title: '创建人', dataIndex: 'createdBy' },
    {
      title: '操作',
      render: (_, record) => (
        <Space>
          <Button type="link" onClick={() => setSelected(record)}>查看详情</Button>
          {!readOnly ? <Button type="link" onClick={() => message.info('编辑入口已预留')}>编辑</Button> : null}
          {!readOnly && record.status !== 'confirmed' ? <Button type="link" onClick={() => { confirmRecord(record.id); message.success('记录已确认'); }}>确认</Button> : null}
          {!readOnly ? <Button type="link" danger onClick={() => deleteRecord(record.id)}>删除</Button> : null}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title={readOnly ? '数据记录查看' : '数据记录'} description="所有最终进入系统的业务数据 BusinessRecord" />
      <Card>
        <Space wrap className="table-filter">
          <Select allowClear placeholder="项目" value={projectId} onChange={setProjectId} style={{ width: 180 }} options={projects.map((item) => ({ label: item.name, value: item.id }))} />
          <Select allowClear placeholder="记录类型" value={recordType} onChange={setRecordType} style={{ width: 160 }} options={Object.entries(recordTypeMap).map(([value, label]) => ({ value, label }))} />
          <Select allowClear placeholder="来源" value={sourceType} onChange={setSourceType} style={{ width: 140 }} options={Object.entries(sourceTypeMap).map(([value, label]) => ({ value, label }))} />
          <Select allowClear placeholder="状态" value={status} onChange={setStatus} style={{ width: 140 }} options={Object.entries(recordStatusMap).map(([value, label]) => ({ value, label }))} />
          <DatePicker.RangePicker />
        </Space>
        <Table rowKey="id" columns={columns} dataSource={data} scroll={{ x: 1100 }} />
      </Card>
      <Drawer title="记录详情" width={620} open={Boolean(selected)} onClose={() => setSelected(null)}>
        {selected ? (
          <Descriptions bordered column={1}>
            <Descriptions.Item label="项目">{selected.projectName}</Descriptions.Item>
            <Descriptions.Item label="模板">{selected.templateName}</Descriptions.Item>
            <Descriptions.Item label="金额">{formatMoney(selected.amount)}</Descriptions.Item>
            <Descriptions.Item label="来源">{sourceTypeMap[selected.sourceType]}</Descriptions.Item>
            <Descriptions.Item label="来源文件/ID">{selected.sourceId}</Descriptions.Item>
            <Descriptions.Item label="动态字段">
              <Space direction="vertical">
                {selected.values.map((item) => (
                  <span key={item.id}>{item.fieldName}：{Array.isArray(item.value) ? item.value.join('、') : String(item.value)}</span>
                ))}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="附件">{selected.attachments.join('、') || '无'}</Descriptions.Item>
            <Descriptions.Item label="创建时间">{selected.createdAt}</Descriptions.Item>
          </Descriptions>
        ) : null}
      </Drawer>
    </div>
  );
}
