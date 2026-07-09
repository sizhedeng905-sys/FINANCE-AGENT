import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Button, Card, Descriptions, Drawer, Form, Input, Modal, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import { useDataCenterStore } from '@/store/dataCenterStore';
import type { Project } from '@/types/dataCenter';
import { projectStatusMap } from '@/utils/dataCenterMaps';

export default function DataProjectsPage({ readOnly = false }: { readOnly?: boolean }) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [form] = Form.useForm<Pick<Project, 'name' | 'customerName' | 'ownerName' | 'description'>>();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [templateProject, setTemplateProject] = useState<Project | null>(null);
  const projects = useDataCenterStore((state) => state.projects);
  const templates = useDataCenterStore((state) => state.templates);
  const projectTemplates = useDataCenterStore((state) => state.projectTemplates);
  const createProject = useDataCenterStore((state) => state.createProject);
  const updateProject = useDataCenterStore((state) => state.updateProject);
  const archiveProject = useDataCenterStore((state) => state.archiveProject);

  const enabledTemplates = useMemo(() => {
    if (!templateProject) return [];
    return projectTemplates
      .filter((item) => item.projectId === templateProject.id && item.isActive)
      .map((item) => ({
        ...item,
        template: templates.find((template) => template.id === item.templateId),
      }));
  }, [projectTemplates, templateProject, templates]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setOpen(true);
  };

  const openEdit = (record: Project) => {
    setEditing(record);
    form.setFieldsValue(record);
    setOpen(true);
  };

  const submit = () => {
    form.validateFields().then((values) => {
      if (editing) {
        updateProject(editing.id, values);
        message.success('项目已更新');
      } else {
        createProject(values);
        message.success('项目已创建');
      }
      setOpen(false);
    });
  };

  const columns: ColumnsType<Project> = [
    { title: '项目名称', dataIndex: 'name' },
    { title: '客户', dataIndex: 'customerName' },
    { title: '负责人', dataIndex: 'ownerName' },
    {
      title: '状态',
      dataIndex: 'status',
      render: (value) => <Tag color={value === 'active' ? 'success' : 'default'}>{projectStatusMap[value as Project['status']]}</Tag>,
    },
    { title: '创建时间', dataIndex: 'createdAt' },
    {
      title: '操作',
      render: (_, record) => (
        <Space>
          {!readOnly ? <Button type="link" onClick={() => openEdit(record)}>编辑</Button> : null}
          <Button type="link" onClick={() => setTemplateProject(record)}>查看模板</Button>
          <Button
            type="link"
            onClick={() => navigate(readOnly ? `/boss/data/projects/${record.id}/structure` : `/data/projects/${record.id}/structure`)}
          >
            查看结构
          </Button>
          {!readOnly && record.status === 'active' ? (
            <Button type="link" danger onClick={() => { archiveProject(record.id); message.success('项目已归档'); }}>归档</Button>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={readOnly ? '项目概览' : '项目管理'}
        description={readOnly ? '老板只读查看项目与启用模板' : '维护项目和项目启用模板'}
        extra={!readOnly ? <Button type="primary" onClick={openCreate}>新建项目</Button> : null}
      />
      <Card>
        <Table rowKey="id" columns={columns} dataSource={projects} scroll={{ x: 900 }} />
      </Card>

      <Modal title={editing ? '编辑项目' : '新建项目'} open={open} onCancel={() => setOpen(false)} onOk={submit}>
        <Form form={form} layout="vertical">
          <Form.Item label="项目名称" name="name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="客户" name="customerName" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="负责人" name="ownerName" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="说明" name="description">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title="项目已启用模板"
        width={520}
        open={Boolean(templateProject)}
        onClose={() => setTemplateProject(null)}
        extra={
          templateProject ? (
            <Button
              type="primary"
              onClick={() => navigate(readOnly ? `/boss/data/projects/${templateProject.id}/structure` : `/data/projects/${templateProject.id}/structure`)}
            >
              进入结构视图
            </Button>
          ) : null
        }
      >
        {templateProject ? (
          <Descriptions bordered column={1}>
            <Descriptions.Item label="项目">{templateProject.name}</Descriptions.Item>
            <Descriptions.Item label="客户">{templateProject.customerName}</Descriptions.Item>
            <Descriptions.Item label="模板">
              <Space direction="vertical">
                {enabledTemplates.length
                  ? enabledTemplates.map((item) => <Tag key={item.id}>{item.customName} · {item.template?.name}</Tag>)
                  : '暂无启用模板'}
              </Space>
            </Descriptions.Item>
          </Descriptions>
        ) : null}
      </Drawer>
    </div>
  );
}
