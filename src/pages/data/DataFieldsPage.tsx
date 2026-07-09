import { useState } from 'react';
import { App, Button, Card, Form, Input, Modal, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import { useDataCenterStore } from '@/store/dataCenterStore';
import type { FieldDefinition } from '@/types/dataCenter';
import { fieldTypeMap, semanticTypeMap } from '@/utils/dataCenterMaps';
import { createSystemFieldName } from '@/utils/fieldName';

export default function DataFieldsPage() {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FieldDefinition | null>(null);
  const [form] = Form.useForm<Omit<FieldDefinition, 'id' | 'createdAt' | 'updatedAt' | 'isActive'>>();
  const fields = useDataCenterStore((state) => state.fields);
  const createField = useDataCenterStore((state) => state.createField);
  const updateField = useDataCenterStore((state) => state.updateField);
  const deactivateField = useDataCenterStore((state) => state.deactivateField);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setOpen(true);
  };
  const openEdit = (record: FieldDefinition) => {
    setEditing(record);
    form.setFieldsValue(record);
    setOpen(true);
  };
  const submit = () => {
    form.validateFields().then((values) => {
      const payload = {
        ...values,
        fieldKey: values.fieldKey || createSystemFieldName(values.fieldName),
        aliases: values.aliases ?? [],
      };
      if (editing) {
        updateField(editing.id, payload);
        message.success('字段已更新');
      } else {
        createField(payload);
        message.success('字段已创建');
      }
      setOpen(false);
    });
  };

  const columns: ColumnsType<FieldDefinition> = [
    { title: '字段名', dataIndex: 'fieldName' },
    { title: '系统识别名', dataIndex: 'fieldKey' },
    { title: '字段类型', dataIndex: 'fieldType', render: (value) => fieldTypeMap[value as FieldDefinition['fieldType']] },
    { title: '单位', dataIndex: 'unit' },
    { title: '语义类型', dataIndex: 'semanticType', render: (value) => semanticTypeMap[value as FieldDefinition['semanticType']] },
    { title: '别名', dataIndex: 'aliases', render: (value: string[]) => value.join('、') },
    { title: '状态', dataIndex: 'isActive', render: (value) => <Tag color={value ? 'success' : 'default'}>{value ? '启用' : '停用'}</Tag> },
    {
      title: '操作',
      render: (_, record) => (
        <Space>
          <Button type="link" onClick={() => openEdit(record)}>编辑</Button>
          {record.isActive ? <Button type="link" danger onClick={() => deactivateField(record.id)}>停用</Button> : null}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="字段字典" description="新增字段是新增字段定义，不是修改数据库列。系统识别名用于系统内部识别字段，通常不需要手动填写。" extra={<Button type="primary" onClick={openCreate}>新建字段</Button>} />
      <Card>
        <Table rowKey="id" columns={columns} dataSource={fields} scroll={{ x: 1100 }} />
      </Card>
      <Modal title={editing ? '编辑字段' : '新建字段'} open={open} onCancel={() => setOpen(false)} onOk={submit}>
        <Form form={form} layout="vertical">
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
