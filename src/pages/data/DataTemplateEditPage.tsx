import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, App, Button, Card, Col, Form, Input, Modal, Popconfirm, Row, Select, Space, Spin, Switch, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import { useDataCenterStore } from '@/store/dataCenterStore';
import type { CreateFieldPayload, TemplateField, UpdateTemplateFieldPayload } from '@/types/dataCenter';
import { fieldTypeMap, recordTypeMap, semanticTypeMap } from '@/utils/dataCenterMaps';

export default function DataTemplateEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [addOpen, setAddOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [operation, setOperation] = useState<string | null>(null);
  const [fieldId, setFieldId] = useState<string>();
  const [fieldForm] = Form.useForm<CreateFieldPayload>();
  const templates = useDataCenterStore((state) => state.templates);
  const templateLoading = useDataCenterStore((state) => state.templateLoading);
  const templateError = useDataCenterStore((state) => state.templateError);
  const fetchTemplate = useDataCenterStore((state) => state.fetchTemplate);
  const fields = useDataCenterStore((state) => state.fields);
  const templateFields = useDataCenterStore((state) => state.templateFields);
  const fieldLoading = useDataCenterStore((state) => state.fieldLoading);
  const fieldError = useDataCenterStore((state) => state.fieldError);
  const templateFieldLoading = useDataCenterStore((state) => state.templateFieldLoading);
  const templateFieldError = useDataCenterStore((state) => state.templateFieldError);
  const fetchFields = useDataCenterStore((state) => state.fetchFields);
  const fetchTemplateFields = useDataCenterStore((state) => state.fetchTemplateFields);
  const updateTemplateField = useDataCenterStore((state) => state.updateTemplateField);
  const removeTemplateField = useDataCenterStore((state) => state.removeTemplateField);
  const moveTemplateField = useDataCenterStore((state) => state.moveTemplateField);
  const addExistingFieldToTemplate = useDataCenterStore((state) => state.addExistingFieldToTemplate);
  const createField = useDataCenterStore((state) => state.createField);

  useEffect(() => {
    if (id) {
      void fetchTemplate(id).catch(() => undefined);
      void fetchTemplateFields(id).catch(() => undefined);
    }
    void fetchFields({ page: 1, pageSize: 100, isActive: true }).catch(() => undefined);
  }, [fetchFields, fetchTemplate, fetchTemplateFields, id]);

  const updateRelation = async (record: TemplateField, payload: UpdateTemplateFieldPayload) => {
    try {
      setOperation(`relation:${record.id}`);
      await updateTemplateField(record.id, payload);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '模板字段更新失败');
    } finally {
      setOperation(null);
    }
  };

  const moveRelation = async (record: TemplateField, direction: 'up' | 'down') => {
    try {
      setOperation(`move:${record.id}`);
      await moveTemplateField(record.id, direction);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '字段排序失败');
    } finally {
      setOperation(null);
    }
  };

  const removeRelation = async (record: TemplateField) => {
    try {
      setOperation(`remove:${record.id}`);
      await removeTemplateField(record.id);
      message.success('字段已从模板移除，字段字典定义仍保留');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '移除失败');
    } finally {
      setOperation(null);
    }
  };

  const template = templates.find((item) => item.id === id);
  const data = useMemo(
    () => templateFields.filter((item) => item.templateId === id).sort((a, b) => a.displayOrder - b.displayOrder),
    [id, templateFields],
  );
  const availableFields = fields.filter((item) => item.isActive && !data.some((tf) => tf.fieldId === item.id));

  const columns: ColumnsType<TemplateField> = [
    { title: '字段名称', render: (_, record) => record.field.fieldName },
    { title: '系统识别名', render: (_, record) => record.field.fieldKey },
    { title: '字段类型', render: (_, record) => fieldTypeMap[record.field.fieldType] },
    { title: '是否必填', dataIndex: 'isRequired', render: (value, record) => <Switch loading={operation === `relation:${record.id}`} checked={value} onChange={(checked) => void updateRelation(record, { isRequired: checked })} /> },
    { title: '是否显示', dataIndex: 'isVisible', render: (value, record) => <Switch loading={operation === `relation:${record.id}`} checked={value} onChange={(checked) => void updateRelation(record, { isVisible: checked })} /> },
    { title: '排序', dataIndex: 'displayOrder' },
    {
      title: '操作',
      render: (_, record) => (
        <Space>
          <Button size="small" loading={operation === `move:${record.id}`} onClick={() => void moveRelation(record, 'up')}>上移</Button>
          <Button size="small" loading={operation === `move:${record.id}`} onClick={() => void moveRelation(record, 'down')}>下移</Button>
          <Popconfirm title="从模板移除字段" description="字段字典定义和历史数据不会删除。" onConfirm={() => removeRelation(record)}>
            <Button size="small" danger loading={operation === `remove:${record.id}`}>移除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  if (templateLoading && !template) {
    return <Card><Spin size="large" /></Card>;
  }

  if (templateError && !template) {
    return <Alert type="error" showIcon message="模板加载失败" description={templateError} />;
  }

  if (!template) {
    return <Card>模板不存在</Card>;
  }

  return (
    <div>
      <PageHeader title="模板编辑" description="字段只从当前模板移除，不删除字段字典定义" extra={<Button onClick={() => navigate('/data/templates')}>返回</Button>} />
      {fieldError || templateFieldError ? (
        <Alert type="error" showIcon message="字段数据加载失败" description={fieldError || templateFieldError} style={{ marginBottom: 16 }} />
      ) : null}
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={7}>
          <Card title="模板基本信息">
            <Space direction="vertical" size={12}>
              <strong>{template.name}</strong>
              <Tag>{recordTypeMap[template.recordType]}</Tag>
              <span>{template.description}</span>
              <span>创建人：{template.createdBy}</span>
              <span>更新时间：{template.updatedAt}</span>
            </Space>
          </Card>
        </Col>
        <Col xs={24} xl={17}>
          <Card
            title="字段列表"
            extra={
              <Space>
                <Button onClick={() => setAddOpen(true)}>添加已有字段</Button>
                <Button type="primary" onClick={() => setNewOpen(true)}>新建字段并加入</Button>
              </Space>
            }
          >
            <Table rowKey="id" columns={columns} dataSource={data} loading={fieldLoading || templateFieldLoading} pagination={false} scroll={{ x: 760 }} />
          </Card>
        </Col>
      </Row>

      <Modal
        title="添加已有字段"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        confirmLoading={operation === 'add-field'}
        onOk={async () => {
          if (!fieldId || !id) return;
          try {
            setOperation('add-field');
            await addExistingFieldToTemplate(id, fieldId);
            message.success('字段已加入模板');
            setAddOpen(false);
            setFieldId(undefined);
          } catch (error) {
            message.error(error instanceof Error ? error.message : '添加字段失败');
          } finally {
            setOperation(null);
          }
        }}
      >
        <Select
          className="full-width"
          placeholder="选择字段"
          value={fieldId}
          onChange={setFieldId}
          options={availableFields.map((item) => ({ label: `${item.fieldName}（${fieldTypeMap[item.fieldType]}）`, value: item.id }))}
        />
      </Modal>

      <Modal
        title="新建字段并加入模板"
        open={newOpen}
        onCancel={() => setNewOpen(false)}
        confirmLoading={operation === 'create-field'}
        onOk={async () => {
          try {
            const values = await fieldForm.validateFields();
            setOperation('create-field');
            const field = await createField({ ...values, fieldKey: values.fieldKey || undefined, aliases: values.aliases ?? [] });
            await addExistingFieldToTemplate(id!, field.id);
            message.success('字段已创建并加入模板');
            setNewOpen(false);
            fieldForm.resetFields();
          } catch (error) {
            if (error instanceof Error) message.error(error.message);
          } finally {
            setOperation(null);
          }
        }}
      >
        <Form form={fieldForm} layout="vertical">
          <Form.Item label="字段名" name="fieldName" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item
            label="系统识别名（自动生成，可选）"
            name="fieldKey"
            tooltip="用于系统内部识别字段，通常不需要手动填写。"
          >
            <Input placeholder="不填则自动生成" />
          </Form.Item>
          <Form.Item label="字段类型" name="fieldType" rules={[{ required: true }]}>
            <Select options={Object.entries(fieldTypeMap).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item label="语义类型" name="semanticType" rules={[{ required: true }]}>
            <Select options={Object.entries(semanticTypeMap).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item label="单位" name="unit"><Input /></Form.Item>
          <Form.Item label="别名，逗号分隔" name="aliases" getValueFromEvent={(event) => String(event.target.value).split(',').map((item) => item.trim()).filter(Boolean)}>
            <Input />
          </Form.Item>
          <Form.Item label="说明" name="description"><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
