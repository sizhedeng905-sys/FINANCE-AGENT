import { useEffect, useState } from 'react';
import { EyeOutlined, EditOutlined, StopOutlined } from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import { useDataCenterStore } from '@/store/dataCenterStore';
import type { CreateFieldPayload, FieldDefinition, FieldType, SemanticType } from '@/types/dataCenter';
import { fieldTypeMap, semanticTypeMap } from '@/utils/dataCenterMaps';

interface FieldFormValues extends Omit<CreateFieldPayload, 'aliases'> {
  aliases?: string;
}

export default function DataFieldsPage() {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FieldDefinition | null>(null);
  const [usageField, setUsageField] = useState<FieldDefinition | null>(null);
  const [keyword, setKeyword] = useState('');
  const [fieldType, setFieldType] = useState<FieldType>();
  const [semanticType, setSemanticType] = useState<SemanticType>();
  const [isActive, setIsActive] = useState<boolean>();
  const [operation, setOperation] = useState<string | null>(null);
  const [form] = Form.useForm<FieldFormValues>();
  const fields = useDataCenterStore((state) => state.fields);
  const fieldPage = useDataCenterStore((state) => state.fieldPage);
  const fieldPageSize = useDataCenterStore((state) => state.fieldPageSize);
  const fieldTotal = useDataCenterStore((state) => state.fieldTotal);
  const fieldLoading = useDataCenterStore((state) => state.fieldLoading);
  const fieldError = useDataCenterStore((state) => state.fieldError);
  const fieldUsage = useDataCenterStore((state) => state.fieldUsage);
  const fetchFields = useDataCenterStore((state) => state.fetchFields);
  const fetchFieldUsage = useDataCenterStore((state) => state.fetchFieldUsage);
  const createField = useDataCenterStore((state) => state.createField);
  const updateField = useDataCenterStore((state) => state.updateField);
  const deactivateField = useDataCenterStore((state) => state.deactivateField);

  useEffect(() => {
    void fetchFields({ page: 1, pageSize: 20 }).catch(() => undefined);
  }, [fetchFields]);

  const queryFields = (page = 1, pageSize = fieldPageSize) =>
    fetchFields({ page, pageSize, keyword, fieldType, semanticType, isActive });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setOpen(true);
  };

  const openEdit = (record: FieldDefinition) => {
    setEditing(record);
    form.setFieldsValue({
      fieldKey: record.fieldKey,
      fieldName: record.fieldName,
      fieldType: record.fieldType,
      unit: record.unit,
      semanticType: record.semanticType,
      aliases: record.aliases.join(', '),
      description: record.description,
    });
    setOpen(true);
  };

  const submit = async () => {
    try {
      const values = await form.validateFields();
      const payload: CreateFieldPayload = {
        ...values,
        fieldKey: values.fieldKey?.trim() || undefined,
        aliases: values.aliases?.split(',').map((item) => item.trim()).filter(Boolean) ?? [],
      };
      setOperation(editing ? `edit:${editing.id}` : 'create');
      if (editing) {
        await updateField(editing.id, payload);
        message.success('字段已更新');
      } else {
        await createField(payload);
        message.success('字段已创建');
      }
      setOpen(false);
      form.resetFields();
    } catch (error) {
      if (error instanceof Error) message.error(error.message);
    } finally {
      setOperation(null);
    }
  };

  const disable = async (record: FieldDefinition) => {
    try {
      setOperation(`disable:${record.id}`);
      await deactivateField(record.id);
      message.success('字段已停用');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '字段停用失败');
    } finally {
      setOperation(null);
    }
  };

  const showUsage = async (record: FieldDefinition) => {
    setUsageField(record);
    try {
      setOperation(`usage:${record.id}`);
      await fetchFieldUsage(record.id);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '使用情况加载失败');
    } finally {
      setOperation(null);
    }
  };

  const columns: ColumnsType<FieldDefinition> = [
    { title: '字段名', dataIndex: 'fieldName' },
    { title: '系统识别名', dataIndex: 'fieldKey' },
    { title: '字段类型', dataIndex: 'fieldType', render: (value: FieldType) => fieldTypeMap[value] },
    { title: '单位', dataIndex: 'unit', render: (value: string) => value || '-' },
    { title: '语义类型', dataIndex: 'semanticType', render: (value: SemanticType) => semanticTypeMap[value] },
    { title: '别名', dataIndex: 'aliases', render: (value: string[]) => value.join('、') || '-' },
    {
      title: '状态',
      dataIndex: 'isActive',
      render: (value: boolean) => <Tag color={value ? 'success' : 'default'}>{value ? '启用' : '停用'}</Tag>,
    },
    {
      title: '操作',
      width: 260,
      fixed: 'right',
      render: (_, record) => (
        <Space wrap>
          <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>编辑</Button>
          <Button
            type="link"
            icon={<EyeOutlined />}
            loading={operation === `usage:${record.id}`}
            onClick={() => void showUsage(record)}
          >
            使用情况
          </Button>
          {record.isActive ? (
            <Popconfirm
              title="停用字段"
              description="已存在的模板关系和历史字段值会保留。"
              okText="确认停用"
              cancelText="取消"
              onConfirm={() => disable(record)}
            >
              <Button
                type="link"
                danger
                icon={<StopOutlined />}
                loading={operation === `disable:${record.id}`}
              >
                停用
              </Button>
            </Popconfirm>
          ) : null}
        </Space>
      ),
    },
  ];

  const usage = usageField ? fieldUsage[usageField.id] : undefined;

  return (
    <div>
      <PageHeader
        title="字段字典"
        description="新增字段是新增字段定义，不是修改数据库列。"
        extra={<Button type="primary" onClick={openCreate}>新建字段</Button>}
      />
      {fieldError ? <Alert type="error" showIcon message="字段数据请求失败" description={fieldError} style={{ marginBottom: 16 }} /> : null}
      <Card>
        <Space wrap className="table-filter">
          <Input.Search
            allowClear
            value={keyword}
            placeholder="搜索字段名、识别名或说明"
            style={{ width: 300 }}
            onChange={(event) => setKeyword(event.target.value)}
            onSearch={() => void queryFields().catch(() => undefined)}
          />
          <Select<FieldType>
            allowClear
            value={fieldType}
            placeholder="字段类型"
            style={{ width: 140 }}
            options={Object.entries(fieldTypeMap).map(([value, label]) => ({ value: value as FieldType, label }))}
            onChange={(value) => {
              setFieldType(value);
              void fetchFields({ page: 1, pageSize: fieldPageSize, keyword, fieldType: value, semanticType, isActive }).catch(() => undefined);
            }}
          />
          <Select<SemanticType>
            allowClear
            value={semanticType}
            placeholder="语义类型"
            style={{ width: 140 }}
            options={Object.entries(semanticTypeMap).map(([value, label]) => ({ value: value as SemanticType, label }))}
            onChange={(value) => {
              setSemanticType(value);
              void fetchFields({ page: 1, pageSize: fieldPageSize, keyword, fieldType, semanticType: value, isActive }).catch(() => undefined);
            }}
          />
          <Select<'active' | 'disabled'>
            allowClear
            value={isActive === undefined ? undefined : isActive ? 'active' : 'disabled'}
            placeholder="状态"
            style={{ width: 120 }}
            options={[{ value: 'active', label: '启用' }, { value: 'disabled', label: '停用' }]}
            onChange={(value) => {
              const active = value === undefined ? undefined : value === 'active';
              setIsActive(active);
              void fetchFields({ page: 1, pageSize: fieldPageSize, keyword, fieldType, semanticType, isActive: active }).catch(() => undefined);
            }}
          />
        </Space>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={fields}
          loading={fieldLoading}
          locale={{ emptyText: <Empty description="暂无字段" /> }}
          scroll={{ x: 1250 }}
          pagination={{
            current: fieldPage,
            pageSize: fieldPageSize,
            total: fieldTotal,
            showSizeChanger: true,
            showTotal: (count) => `共 ${count} 个字段`,
            onChange: (page, pageSize) => void queryFields(page, pageSize).catch(() => undefined),
          }}
        />
      </Card>

      <Modal
        title={editing ? '编辑字段' : '新建字段'}
        open={open}
        confirmLoading={operation === 'create' || operation === `edit:${editing?.id}`}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="字段名" name="fieldName" rules={[{ required: true, whitespace: true, message: '请输入字段名' }]}><Input maxLength={100} /></Form.Item>
          <Form.Item label="系统识别名（自动生成，可选）" name="fieldKey"><Input maxLength={100} placeholder="留空由后端生成" /></Form.Item>
          <Form.Item label="字段类型" name="fieldType" rules={[{ required: true, message: '请选择字段类型' }]}>
            <Select options={Object.entries(fieldTypeMap).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item label="语义类型" name="semanticType" rules={[{ required: true, message: '请选择语义类型' }]}>
            <Select options={Object.entries(semanticTypeMap).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item label="单位" name="unit"><Input maxLength={30} /></Form.Item>
          <Form.Item label="别名，逗号分隔" name="aliases"><Input maxLength={500} /></Form.Item>
          <Form.Item label="说明" name="description"><Input.TextArea rows={3} maxLength={1000} showCount /></Form.Item>
        </Form>
      </Modal>

      <Drawer title="字段使用情况" width={560} open={Boolean(usageField)} onClose={() => setUsageField(null)}>
        {usage ? (
          <Descriptions bordered column={1}>
            <Descriptions.Item label="字段">{usage.field.fieldName}</Descriptions.Item>
            <Descriptions.Item label="系统识别名">{usage.field.fieldKey}</Descriptions.Item>
            <Descriptions.Item label="关联模板数">{usage.templateCount}</Descriptions.Item>
            <Descriptions.Item label="启用项目数">{usage.projectCount}</Descriptions.Item>
            <Descriptions.Item label="模板">{usage.templates.map((item) => item.name).join('、') || '-'}</Descriptions.Item>
            <Descriptions.Item label="项目">{usage.projects.map((item) => item.name).join('、') || '-'}</Descriptions.Item>
          </Descriptions>
        ) : <Empty description="暂无使用数据" />}
      </Drawer>
    </div>
  );
}
