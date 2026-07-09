import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { App, Button, Card, Col, Form, Input, Modal, Row, Select, Space, Switch, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import { useDataCenterStore } from '@/store/dataCenterStore';
import type { FieldDefinition, TemplateField } from '@/types/dataCenter';
import { fieldTypeMap, recordTypeMap, semanticTypeMap } from '@/utils/dataCenterMaps';

export default function DataTemplateEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [addOpen, setAddOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [fieldId, setFieldId] = useState<string>();
  const [fieldForm] = Form.useForm<Omit<FieldDefinition, 'id' | 'createdAt' | 'updatedAt' | 'isActive'>>();
  const templates = useDataCenterStore((state) => state.templates);
  const fields = useDataCenterStore((state) => state.fields);
  const templateFields = useDataCenterStore((state) => state.templateFields);
  const updateTemplateField = useDataCenterStore((state) => state.updateTemplateField);
  const removeTemplateField = useDataCenterStore((state) => state.removeTemplateField);
  const moveTemplateField = useDataCenterStore((state) => state.moveTemplateField);
  const addExistingFieldToTemplate = useDataCenterStore((state) => state.addExistingFieldToTemplate);
  const createField = useDataCenterStore((state) => state.createField);

  const template = templates.find((item) => item.id === id);
  const data = useMemo(
    () => templateFields.filter((item) => item.templateId === id).sort((a, b) => a.displayOrder - b.displayOrder),
    [id, templateFields],
  );
  const availableFields = fields.filter((item) => item.isActive && !data.some((tf) => tf.fieldId === item.id));

  const columns: ColumnsType<TemplateField> = [
    { title: '字段名称', render: (_, record) => record.field.fieldName },
    { title: '字段类型', render: (_, record) => fieldTypeMap[record.field.fieldType] },
    { title: '是否必填', dataIndex: 'isRequired', render: (value, record) => <Switch checked={value} onChange={(checked) => updateTemplateField(record.id, { isRequired: checked })} /> },
    { title: '是否显示', dataIndex: 'isVisible', render: (value, record) => <Switch checked={value} onChange={(checked) => updateTemplateField(record.id, { isVisible: checked })} /> },
    { title: '排序', dataIndex: 'displayOrder' },
    {
      title: '操作',
      render: (_, record) => (
        <Space>
          <Button size="small" onClick={() => moveTemplateField(record.id, 'up')}>上移</Button>
          <Button size="small" onClick={() => moveTemplateField(record.id, 'down')}>下移</Button>
          <Button size="small" danger onClick={() => removeTemplateField(record.id)}>移除</Button>
        </Space>
      ),
    },
  ];

  if (!template) {
    return <Card>模板不存在</Card>;
  }

  return (
    <div>
      <PageHeader title="模板编辑" description="字段只从当前模板移除，不删除字段字典定义" extra={<Button onClick={() => navigate('/data/templates')}>返回</Button>} />
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
            <Table rowKey="id" columns={columns} dataSource={data} pagination={false} scroll={{ x: 760 }} />
          </Card>
        </Col>
      </Row>

      <Modal
        title="添加已有字段"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={() => {
          if (!fieldId || !id) return;
          addExistingFieldToTemplate(id, fieldId);
          message.success('字段已加入模板');
          setAddOpen(false);
          setFieldId(undefined);
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
        onOk={() => {
          fieldForm.validateFields().then((values) => {
            const field = createField({ ...values, aliases: values.aliases ?? [] });
            addExistingFieldToTemplate(id!, field.id);
            message.success('字段已创建并加入模板');
            setNewOpen(false);
            fieldForm.resetFields();
          });
        }}
      >
        <Form form={fieldForm} layout="vertical">
          <Form.Item label="字段名" name="fieldName" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="字段key" name="fieldKey" rules={[{ required: true }]}><Input /></Form.Item>
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
