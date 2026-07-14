import { useEffect, useState } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import {
  Alert,
  App,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import AttachmentPreview from '@/components/workOrder/AttachmentPreview';
import { useDataCenterStore } from '@/store/dataCenterStore';
import type { BusinessRecord, RecordListQuery, UpdateRecordPayload } from '@/types/dataCenter';
import { formatMoney } from '@/utils/format';
import { recordStatusMap, recordTypeMap, sourceTypeMap } from '@/utils/dataCenterMaps';

interface EditRecordForm {
  recordDate: Dayjs;
  amount: string;
  category?: string;
  subCategory?: string;
  description?: string;
}

export default function DataRecordsPage({ readOnly = false }: { readOnly?: boolean }) {
  const { message } = App.useApp();
  const [selected, setSelected] = useState<BusinessRecord | null>(null);
  const [editing, setEditing] = useState<BusinessRecord | null>(null);
  const [projectId, setProjectId] = useState<string>();
  const [recordType, setRecordType] = useState<BusinessRecord['recordType']>();
  const [sourceType, setSourceType] = useState<BusinessRecord['sourceType']>();
  const [status, setStatus] = useState<BusinessRecord['status']>();
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [operation, setOperation] = useState<string | null>(null);
  const [form] = Form.useForm<EditRecordForm>();
  const projects = useDataCenterStore((state) => state.projects);
  const projectLoading = useDataCenterStore((state) => state.projectLoading);
  const projectError = useDataCenterStore((state) => state.projectError);
  const fetchProjects = useDataCenterStore((state) => state.fetchProjects);
  const records = useDataCenterStore((state) => state.records);
  const recordPage = useDataCenterStore((state) => state.recordPage);
  const recordPageSize = useDataCenterStore((state) => state.recordPageSize);
  const recordTotal = useDataCenterStore((state) => state.recordTotal);
  const recordLoading = useDataCenterStore((state) => state.recordLoading);
  const recordError = useDataCenterStore((state) => state.recordError);
  const fetchRecords = useDataCenterStore((state) => state.fetchRecords);
  const fetchRecord = useDataCenterStore((state) => state.fetchRecord);
  const updateRecord = useDataCenterStore((state) => state.updateRecord);
  const confirmRecord = useDataCenterStore((state) => state.confirmRecord);
  const deleteRecord = useDataCenterStore((state) => state.deleteRecord);

  useEffect(() => {
    void fetchProjects({ page: 1, pageSize: 100 }).catch(() => undefined);
    void fetchRecords({ page: 1, pageSize: 20 }).catch(() => undefined);
  }, [fetchProjects, fetchRecords]);

  const query = (overrides: RecordListQuery = {}) => {
    const has = (key: keyof RecordListQuery) => Object.prototype.hasOwnProperty.call(overrides, key);
    return fetchRecords({
      page: overrides.page ?? 1,
      pageSize: overrides.pageSize ?? recordPageSize,
      projectId: has('projectId') ? overrides.projectId : projectId,
      recordType: has('recordType') ? overrides.recordType : recordType,
      sourceType: has('sourceType') ? overrides.sourceType : sourceType,
      status: has('status') ? overrides.status : status,
      dateFrom: has('dateFrom') ? overrides.dateFrom : dateRange?.[0].format('YYYY-MM-DD'),
      dateTo: has('dateTo') ? overrides.dateTo : dateRange?.[1].format('YYYY-MM-DD'),
    });
  };

  const showDetail = async (record: BusinessRecord) => {
    try {
      setOperation(`detail:${record.id}`);
      setSelected(await fetchRecord(record.id));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '记录详情加载失败');
    } finally {
      setOperation(null);
    }
  };

  const openEdit = (record: BusinessRecord) => {
    setEditing(record);
    form.setFieldsValue({
      recordDate: dayjs(record.recordDate),
      amount: record.amount,
      category: record.category,
      subCategory: record.subCategory,
      description: record.description,
    });
  };

  const submitEdit = async () => {
    if (!editing) return;
    try {
      const values = await form.validateFields();
      const payload: UpdateRecordPayload = {
        ...values,
        recordDate: values.recordDate.format('YYYY-MM-DD'),
      };
      setOperation(`edit:${editing.id}`);
      const record = await updateRecord(editing.id, payload);
      if (selected?.id === record.id) setSelected(record);
      setEditing(null);
      form.resetFields();
      message.success('记录已更新');
    } catch (error) {
      if (error instanceof Error) message.error(error.message);
    } finally {
      setOperation(null);
    }
  };

  const confirm = async (record: BusinessRecord) => {
    try {
      setOperation(`confirm:${record.id}`);
      const updated = await confirmRecord(record.id);
      if (selected?.id === updated.id) setSelected(updated);
      message.success('记录已确认');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '记录确认失败');
    } finally {
      setOperation(null);
    }
  };

  const voidRecord = async (record: BusinessRecord) => {
    try {
      setOperation(`void:${record.id}`);
      await deleteRecord(record.id);
      if (selected?.id === record.id) setSelected(null);
      message.success('记录已作废，历史数据仍保留');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '记录作废失败');
    } finally {
      setOperation(null);
    }
  };

  const columns: ColumnsType<BusinessRecord> = [
    { title: '日期', dataIndex: 'recordDate', render: (value: string) => value.slice(0, 10) },
    { title: '项目', dataIndex: 'projectName' },
    { title: '类型', dataIndex: 'recordType', render: (value) => recordTypeMap[value as BusinessRecord['recordType']] },
    { title: '金额', dataIndex: 'amount', render: (value) => formatMoney(value) },
    { title: '分类', dataIndex: 'category', render: (value: string) => value || '-' },
    { title: '来源', dataIndex: 'sourceType', render: (value) => sourceTypeMap[value as BusinessRecord['sourceType']] },
    { title: '状态', dataIndex: 'status', render: (value) => <Tag>{recordStatusMap[value as BusinessRecord['status']]}</Tag> },
    { title: '创建人', dataIndex: 'createdBy' },
    {
      title: '操作',
      width: 300,
      fixed: 'right',
      render: (_, record) => {
        const mutable = record.status === 'draft' || record.status === 'pending_confirm';
        return (
          <Space wrap>
            <Button type="link" loading={operation === `detail:${record.id}`} onClick={() => void showDetail(record)}>查看详情</Button>
            {!readOnly && mutable ? <Button type="link" onClick={() => openEdit(record)}>编辑</Button> : null}
            {!readOnly && mutable ? (
              <Popconfirm title="确认业务记录" description="确认后不能直接修改。" okText="确认" cancelText="取消" onConfirm={() => confirm(record)}>
                <Button type="link" loading={operation === `confirm:${record.id}`}>确认</Button>
              </Popconfirm>
            ) : null}
            {!readOnly && record.status !== 'rejected' ? (
              <Popconfirm title="作废业务记录" description="记录和动态字段值会保留用于审计。" okText="确认作废" cancelText="取消" onConfirm={() => voidRecord(record)}>
                <Button type="link" danger loading={operation === `void:${record.id}`}>作废</Button>
              </Popconfirm>
            ) : null}
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader title={readOnly ? '数据记录查看' : '数据记录'} description="所有最终进入系统的业务数据 BusinessRecord" />
      {projectError ? <Alert type="error" showIcon message="项目列表加载失败" description={projectError} /> : null}
      {recordError ? <Alert type="error" showIcon message="业务记录请求失败" description={recordError} style={{ marginTop: 12 }} /> : null}
      <Card className="section-row">
        <Space wrap className="table-filter">
          <Select<BusinessRecord['projectId']>
            loading={projectLoading}
            allowClear
            placeholder="项目"
            value={projectId}
            onChange={(value) => { setProjectId(value); void query({ projectId: value }); }}
            style={{ width: 180 }}
            options={projects.map((item) => ({ label: item.name, value: item.id }))}
          />
          <Select<BusinessRecord['recordType']>
            allowClear
            placeholder="记录类型"
            value={recordType}
            onChange={(value) => { setRecordType(value); void query({ recordType: value }); }}
            style={{ width: 160 }}
            options={Object.entries(recordTypeMap).map(([value, label]) => ({ value: value as BusinessRecord['recordType'], label }))}
          />
          <Select<BusinessRecord['sourceType']>
            allowClear
            placeholder="来源"
            value={sourceType}
            onChange={(value) => { setSourceType(value); void query({ sourceType: value }); }}
            style={{ width: 140 }}
            options={Object.entries(sourceTypeMap).map(([value, label]) => ({ value: value as BusinessRecord['sourceType'], label }))}
          />
          <Select<BusinessRecord['status']>
            allowClear
            placeholder="状态"
            value={status}
            onChange={(value) => { setStatus(value); void query({ status: value }); }}
            style={{ width: 140 }}
            options={Object.entries(recordStatusMap).map(([value, label]) => ({ value: value as BusinessRecord['status'], label }))}
          />
          <DatePicker.RangePicker
            value={dateRange}
            onChange={(value) => {
              const range = value?.[0] && value?.[1] ? [value[0], value[1]] as [Dayjs, Dayjs] : null;
              setDateRange(range);
              void query({
                dateFrom: range?.[0].format('YYYY-MM-DD') ?? '',
                dateTo: range?.[1].format('YYYY-MM-DD') ?? '',
              });
            }}
          />
        </Space>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={records}
          loading={recordLoading}
          locale={{ emptyText: <Empty description="暂无业务记录" /> }}
          scroll={{ x: 1250 }}
          pagination={{
            current: recordPage,
            pageSize: recordPageSize,
            total: recordTotal,
            showSizeChanger: true,
            showTotal: (count) => `共 ${count} 条记录`,
            onChange: (page, pageSize) => void query({ page, pageSize }),
          }}
        />
      </Card>

      <Drawer title="记录详情" width={620} open={Boolean(selected)} onClose={() => setSelected(null)}>
        {selected ? (
          <Descriptions bordered column={1}>
            <Descriptions.Item label="项目">{selected.projectName}</Descriptions.Item>
            <Descriptions.Item label="模板">{selected.templateName}</Descriptions.Item>
            <Descriptions.Item label="金额">{formatMoney(selected.amount)}</Descriptions.Item>
            <Descriptions.Item label="状态">{recordStatusMap[selected.status]}</Descriptions.Item>
            <Descriptions.Item label="来源">{sourceTypeMap[selected.sourceType]}</Descriptions.Item>
            <Descriptions.Item label="来源文件/ID">{selected.sourceId}</Descriptions.Item>
            <Descriptions.Item label="动态字段">
              <Space direction="vertical">
                {selected.values.map((item) => (
                  <span key={item.id}>
                    {item.fieldName}：{item.fieldType === 'file' && Array.isArray(item.value)
                      ? `已关联 ${item.value.length} 个原始文件`
                      : Array.isArray(item.value) ? item.value.join('、') : String(item.value ?? '-')}
                  </span>
                ))}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="附件"><AttachmentPreview attachments={selected.attachments} /></Descriptions.Item>
            <Descriptions.Item label="创建时间">{selected.createdAt}</Descriptions.Item>
            <Descriptions.Item label="确认时间">{selected.confirmedAt || '-'}</Descriptions.Item>
          </Descriptions>
        ) : null}
      </Drawer>

      <Modal
        title="编辑业务记录"
        open={Boolean(editing)}
        confirmLoading={operation === `edit:${editing?.id}`}
        onCancel={() => setEditing(null)}
        onOk={() => void submitEdit()}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="记录日期" name="recordDate" rules={[{ required: true, message: '请选择记录日期' }]}><DatePicker className="full-width" /></Form.Item>
          <Form.Item label="金额" name="amount" rules={[{ required: true, message: '请输入金额' }]}><InputNumber stringMode className="full-width" precision={2} /></Form.Item>
          <Form.Item label="分类" name="category"><Input maxLength={100} /></Form.Item>
          <Form.Item label="子分类" name="subCategory"><Input maxLength={100} /></Form.Item>
          <Form.Item label="说明" name="description"><Input.TextArea rows={3} maxLength={1000} showCount /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
