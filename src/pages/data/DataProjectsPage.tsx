import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DatabaseOutlined, EditOutlined, EyeOutlined, InboxOutlined } from '@ant-design/icons';
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
import type { CreateProjectPayload, Project } from '@/types/dataCenter';
import { projectStatusMap } from '@/utils/dataCenterMaps';

export default function DataProjectsPage({ readOnly = false }: { readOnly?: boolean }) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [form] = Form.useForm<CreateProjectPayload>();
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<Project['status']>();
  const [operation, setOperation] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [templateProject, setTemplateProject] = useState<Project | null>(null);
  const projects = useDataCenterStore((state) => state.projects);
  const projectPage = useDataCenterStore((state) => state.projectPage);
  const projectPageSize = useDataCenterStore((state) => state.projectPageSize);
  const projectTotal = useDataCenterStore((state) => state.projectTotal);
  const projectLoading = useDataCenterStore((state) => state.projectLoading);
  const projectError = useDataCenterStore((state) => state.projectError);
  const templates = useDataCenterStore((state) => state.templates);
  const fetchTemplates = useDataCenterStore((state) => state.fetchTemplates);
  const projectTemplates = useDataCenterStore((state) => state.projectTemplates);
  const projectTemplateLoading = useDataCenterStore((state) => state.projectTemplateLoading);
  const projectTemplateError = useDataCenterStore((state) => state.projectTemplateError);
  const fetchProjectTemplates = useDataCenterStore((state) => state.fetchProjectTemplates);
  const fetchProjects = useDataCenterStore((state) => state.fetchProjects);
  const createProject = useDataCenterStore((state) => state.createProject);
  const updateProject = useDataCenterStore((state) => state.updateProject);
  const archiveProject = useDataCenterStore((state) => state.archiveProject);

  useEffect(() => {
    void fetchProjects({ page: 1, pageSize: 20 }).catch(() => undefined);
  }, [fetchProjects]);

  useEffect(() => {
    if (!readOnly) void fetchTemplates({ page: 1, pageSize: 100 }).catch(() => undefined);
  }, [fetchTemplates, readOnly]);

  const enabledTemplates = useMemo(() => {
    if (!templateProject) return [];
    return projectTemplates
      .filter((item) => item.projectId === templateProject.id && item.isActive)
      .map((item) => ({
        ...item,
        template: item.template ?? templates.find((template) => template.id === item.templateId),
      }));
  }, [projectTemplates, templateProject, templates]);

  const queryProjects = (nextPage = 1, nextPageSize = projectPageSize) =>
    fetchProjects({ page: nextPage, pageSize: nextPageSize, keyword, status });

  const openProjectTemplates = async (record: Project) => {
    setTemplateProject(record);
    try {
      await fetchProjectTemplates(record.id);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '项目模板加载失败');
    }
  };

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setOpen(true);
  };

  const openEdit = (record: Project) => {
    setEditing(record);
    form.setFieldsValue({
      name: record.name,
      customerName: record.customerName,
      ownerName: record.ownerName,
      description: record.description,
      status: record.status,
    });
    setOpen(true);
  };

  const submit = async () => {
    try {
      const values = await form.validateFields();
      setOperation(editing ? `edit:${editing.id}` : 'create');
      if (editing) {
        await updateProject(editing.id, values);
        message.success('项目已更新');
      } else {
        await createProject(values);
        message.success('项目已创建');
      }
      setOpen(false);
      form.resetFields();
    } catch (error) {
      if (error instanceof Error) message.error(error.message);
    } finally {
      setOperation(null);
    }
  };

  const archive = async (record: Project) => {
    try {
      setOperation(`archive:${record.id}`);
      await archiveProject(record.id);
      message.success('项目已归档');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '项目归档失败');
    } finally {
      setOperation(null);
    }
  };

  const columns: ColumnsType<Project> = [
    { title: '项目名称', dataIndex: 'name' },
    { title: '客户', dataIndex: 'customerName' },
    { title: '负责人', dataIndex: 'ownerName' },
    {
      title: '状态',
      dataIndex: 'status',
      render: (value: Project['status']) => (
        <Tag color={value === 'active' ? 'success' : 'default'}>{projectStatusMap[value]}</Tag>
      ),
    },
    { title: '创建时间', dataIndex: 'createdAt', render: (value: string) => new Date(value).toLocaleString('zh-CN') },
    {
      title: '操作',
      width: 390,
      fixed: 'right',
      render: (_, record) => (
        <Space wrap>
          {!readOnly ? (
            <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>编辑</Button>
          ) : null}
          <Button type="link" icon={<DatabaseOutlined />} onClick={() => void openProjectTemplates(record)}>查看模板</Button>
          <Button
            type="link"
            icon={<EyeOutlined />}
            onClick={() => navigate(readOnly ? `/boss/data/projects/${record.id}/structure` : `/data/projects/${record.id}/structure`)}
          >
            查看结构
          </Button>
          {!readOnly && record.status === 'active' ? (
            <Popconfirm
              title="归档项目"
              description="项目会保留历史数据，并从员工可选项目中移除。"
              okText="确认归档"
              cancelText="取消"
              onConfirm={() => archive(record)}
            >
              <Button
                type="link"
                danger
                icon={<InboxOutlined />}
                loading={operation === `archive:${record.id}`}
              >
                归档
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
        title={readOnly ? '项目概览' : '项目管理'}
        description={readOnly ? '老板只读查看项目与启用模板' : '维护项目和项目启用模板'}
        extra={!readOnly ? <Button type="primary" onClick={openCreate}>新建项目</Button> : null}
      />
      {projectError ? (
        <Alert type="error" showIcon message="项目数据请求失败" description={projectError} style={{ marginBottom: 16 }} />
      ) : null}
      <Card>
        <Space wrap className="table-filter">
          <Input.Search
            allowClear
            value={keyword}
            placeholder="搜索项目、客户或负责人"
            style={{ width: 300 }}
            onChange={(event) => setKeyword(event.target.value)}
            onSearch={() => void queryProjects().catch(() => undefined)}
          />
          <Select<Project['status']>
            allowClear
            value={status}
            placeholder="项目状态"
            style={{ width: 150 }}
            options={Object.entries(projectStatusMap).map(([value, label]) => ({ value: value as Project['status'], label }))}
            onChange={(value) => {
              setStatus(value);
              void fetchProjects({ page: 1, pageSize: projectPageSize, keyword, status: value }).catch(() => undefined);
            }}
          />
        </Space>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={projects}
          loading={projectLoading}
          locale={{ emptyText: <Empty description="暂无项目" /> }}
          scroll={{ x: 1050 }}
          pagination={{
            current: projectPage,
            pageSize: projectPageSize,
            total: projectTotal,
            showSizeChanger: true,
            showTotal: (count) => `共 ${count} 个项目`,
            onChange: (page, pageSize) => void queryProjects(page, pageSize).catch(() => undefined),
          }}
        />
      </Card>

      <Modal
        title={editing ? '编辑项目' : '新建项目'}
        open={open}
        confirmLoading={operation === 'create' || operation === `edit:${editing?.id}`}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="项目名称" name="name" rules={[{ required: true, whitespace: true, message: '请输入项目名称' }]}>
            <Input maxLength={120} />
          </Form.Item>
          <Form.Item label="客户" name="customerName" rules={[{ required: true, whitespace: true, message: '请输入客户名称' }]}>
            <Input maxLength={120} />
          </Form.Item>
          <Form.Item label="负责人" name="ownerName" rules={[{ required: true, whitespace: true, message: '请输入负责人' }]}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item label="说明" name="description">
            <Input.TextArea rows={3} maxLength={1000} showCount />
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
        {projectTemplateError ? <Alert type="error" showIcon message="项目模板加载失败" description={projectTemplateError} /> : null}
        {templateProject && !projectTemplateLoading ? (
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
        ) : projectTemplateLoading ? <Card loading /> : null}
      </Drawer>
    </div>
  );
}
