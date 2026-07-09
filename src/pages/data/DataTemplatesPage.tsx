import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Button, Card, Form, Input, Modal, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import { useAuthStore } from '@/store/authStore';
import { useDataCenterStore } from '@/store/dataCenterStore';
import type { DataRecordType, DataTemplate } from '@/types/dataCenter';
import { recordTypeMap } from '@/utils/dataCenterMaps';

export default function DataTemplatesPage() {
  const { message } = App.useApp();
  const [form] = Form.useForm<Pick<DataTemplate, 'name' | 'recordType' | 'description'>>();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const templates = useDataCenterStore((state) => state.templates);
  const templateFields = useDataCenterStore((state) => state.templateFields);
  const createTemplate = useDataCenterStore((state) => state.createTemplate);
  const cloneTemplate = useDataCenterStore((state) => state.cloneTemplate);
  const deleteTemplate = useDataCenterStore((state) => state.deleteTemplate);

  const submit = () => {
    form.validateFields().then((values) => {
      const template = createTemplate(values, user?.name ?? '财务');
      message.success('模板已创建');
      setOpen(false);
      navigate(`/data/templates/${template.id}`);
    });
  };

  const columns: ColumnsType<DataTemplate> = [
    { title: '模板名称', dataIndex: 'name' },
    { title: '类型', dataIndex: 'recordType', render: (value) => recordTypeMap[value as DataRecordType] },
    { title: '是否系统内置', dataIndex: 'isSystem', render: (value) => <Tag color={value ? 'blue' : 'default'}>{value ? '系统内置' : '自定义'}</Tag> },
    { title: '字段数量', render: (_, record) => templateFields.filter((item) => item.templateId === record.id).length },
    { title: '创建人', dataIndex: 'createdBy' },
    {
      title: '操作',
      render: (_, record) => (
        <Space>
          <Button type="link" onClick={() => navigate(`/data/templates/${record.id}`)}>编辑</Button>
          <Button type="link" onClick={() => { cloneTemplate(record.id, user?.name ?? '财务'); message.success('模板已复制'); }}>复制</Button>
          {!record.isSystem ? <Button type="link" danger onClick={() => deleteTemplate(record.id)}>删除</Button> : null}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="模板管理" description="维护动态数据模板和字段结构" extra={<Button type="primary" onClick={() => setOpen(true)}>新建模板</Button>} />
      <Card>
        <Table rowKey="id" columns={columns} dataSource={templates} scroll={{ x: 900 }} />
      </Card>
      <Modal title="新建模板" open={open} onCancel={() => setOpen(false)} onOk={submit}>
        <Form form={form} layout="vertical">
          <Form.Item label="模板名称" name="name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="类型" name="recordType" rules={[{ required: true }]}>
            <Select options={Object.entries(recordTypeMap).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item label="说明" name="description"><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
