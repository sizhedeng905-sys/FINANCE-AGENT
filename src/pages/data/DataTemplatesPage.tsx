import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CopyOutlined, DeleteOutlined, EditOutlined, FormOutlined } from '@ant-design/icons';
import { Alert, App, Button, Card, Empty, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import { useDataCenterStore } from '@/store/dataCenterStore';
import type { CreateTemplatePayload, DataRecordType, DataTemplate } from '@/types/dataCenter';
import { recordTypeMap } from '@/utils/dataCenterMaps';

const dataLayerMap = {
  actual: '实际经营',
  reconciliation: '对账汇总',
  budget: '预算',
} as const;

export default function DataTemplatesPage() {
  const { message } = App.useApp();
  const [form] = Form.useForm<CreateTemplatePayload>();
  const [keyword, setKeyword] = useState('');
  const [recordType, setRecordType] = useState<DataRecordType>();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DataTemplate | null>(null);
  const [operation, setOperation] = useState<string | null>(null);
  const navigate = useNavigate();
  const templates = useDataCenterStore((state) => state.templates);
  const templatePage = useDataCenterStore((state) => state.templatePage);
  const templatePageSize = useDataCenterStore((state) => state.templatePageSize);
  const templateTotal = useDataCenterStore((state) => state.templateTotal);
  const templateLoading = useDataCenterStore((state) => state.templateLoading);
  const templateError = useDataCenterStore((state) => state.templateError);
  const fetchTemplates = useDataCenterStore((state) => state.fetchTemplates);
  const createTemplate = useDataCenterStore((state) => state.createTemplate);
  const updateTemplate = useDataCenterStore((state) => state.updateTemplate);
  const cloneTemplate = useDataCenterStore((state) => state.cloneTemplate);
  const deleteTemplate = useDataCenterStore((state) => state.deleteTemplate);

  useEffect(() => {
    void fetchTemplates({ page: 1, pageSize: 20 }).catch(() => undefined);
  }, [fetchTemplates]);

  const queryTemplates = (page = 1, pageSize = templatePageSize) =>
    fetchTemplates({ page, pageSize, keyword, recordType });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setOpen(true);
  };

  const openEdit = (template: DataTemplate) => {
    setEditing(template);
    form.setFieldsValue({
      name: template.name,
      recordType: template.recordType,
      dataLayer: template.dataLayer,
      description: template.description,
    });
    setOpen(true);
  };

  const submit = async () => {
    try {
      const values = await form.validateFields();
      setOperation(editing ? `edit:${editing.id}` : 'create');
      if (editing) {
        await updateTemplate(editing.id, values);
        message.success('模板已更新');
      } else {
        await createTemplate(values);
        message.success('模板已创建');
      }
      setOpen(false);
      form.resetFields();
    } catch (error) {
      if (error instanceof Error) message.error(error.message);
    } finally {
      setOperation(null);
    }
  };

  const clone = async (template: DataTemplate) => {
    try {
      setOperation(`clone:${template.id}`);
      await cloneTemplate(template.id);
      message.success('模板及字段关系已复制');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '模板复制失败');
    } finally {
      setOperation(null);
    }
  };

  const remove = async (template: DataTemplate) => {
    try {
      setOperation(`delete:${template.id}`);
      await deleteTemplate(template.id);
      message.success('模板已删除');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '模板删除失败');
    } finally {
      setOperation(null);
    }
  };

  const columns: ColumnsType<DataTemplate> = [
    { title: '模板名称', dataIndex: 'name' },
    { title: '类型', dataIndex: 'recordType', render: (value: DataRecordType) => recordTypeMap[value] },
    { title: '数据层', dataIndex: 'dataLayer', render: (value: keyof typeof dataLayerMap) => <Tag>{dataLayerMap[value]}</Tag> },
    {
      title: '模板属性',
      dataIndex: 'isSystem',
      render: (value: boolean) => <Tag color={value ? 'blue' : 'default'}>{value ? '系统内置' : '自定义'}</Tag>,
    },
    { title: '创建人', dataIndex: 'createdBy' },
    {
      title: '操作',
      width: 390,
      fixed: 'right',
      render: (_, record) => (
        <Space wrap>
          <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>基本信息</Button>
          <Button type="link" icon={<FormOutlined />} onClick={() => navigate(`/data/templates/${record.id}`)}>编辑字段</Button>
          <Button
            type="link"
            icon={<CopyOutlined />}
            loading={operation === `clone:${record.id}`}
            onClick={() => void clone(record)}
          >
            复制
          </Button>
          {!record.isSystem ? (
            <Popconfirm
              title="删除模板"
              description="已被项目或业务记录使用的模板不能删除。"
              okText="确认删除"
              cancelText="取消"
              onConfirm={() => remove(record)}
            >
              <Button
                type="link"
                danger
                icon={<DeleteOutlined />}
                loading={operation === `delete:${record.id}`}
              >
                删除
              </Button>
            </Popconfirm>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="模板管理"
        description="维护动态数据模板和字段结构"
        extra={<Button type="primary" onClick={openCreate}>新建模板</Button>}
      />
      {templateError ? (
        <Alert type="error" showIcon message="模板数据请求失败" description={templateError} style={{ marginBottom: 16 }} />
      ) : null}
      <Card>
        <Space wrap className="table-filter">
          <Input.Search
            allowClear
            value={keyword}
            placeholder="搜索模板名称或说明"
            style={{ width: 300 }}
            onChange={(event) => setKeyword(event.target.value)}
            onSearch={() => void queryTemplates().catch(() => undefined)}
          />
          <Select<DataRecordType>
            allowClear
            value={recordType}
            placeholder="记录类型"
            style={{ width: 160 }}
            options={Object.entries(recordTypeMap).map(([value, label]) => ({ value: value as DataRecordType, label }))}
            onChange={(value) => {
              setRecordType(value);
              void fetchTemplates({ page: 1, pageSize: templatePageSize, keyword, recordType: value }).catch(() => undefined);
            }}
          />
        </Space>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={templates}
          loading={templateLoading}
          locale={{ emptyText: <Empty description="暂无模板" /> }}
          scroll={{ x: 1050 }}
          pagination={{
            current: templatePage,
            pageSize: templatePageSize,
            total: templateTotal,
            showSizeChanger: true,
            showTotal: (count) => `共 ${count} 个模板`,
            onChange: (page, pageSize) => void queryTemplates(page, pageSize).catch(() => undefined),
          }}
        />
      </Card>
      <Modal
        title={editing ? '编辑模板基本信息' : '新建模板'}
        open={open}
        confirmLoading={operation === 'create' || operation === `edit:${editing?.id}`}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="模板名称" name="name" rules={[{ required: true, whitespace: true, message: '请输入模板名称' }]}>
            <Input maxLength={120} />
          </Form.Item>
          <Form.Item label="类型" name="recordType" rules={[{ required: true, message: '请选择记录类型' }]}>
            <Select options={Object.entries(recordTypeMap).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item label="数据层" name="dataLayer" initialValue="actual" rules={[{ required: true, message: '请选择数据层' }]}>
            <Select options={Object.entries(dataLayerMap).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item label="说明" name="description">
            <Input.TextArea rows={3} maxLength={1000} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
