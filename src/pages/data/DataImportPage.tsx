import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { InboxOutlined } from '@ant-design/icons';
import { Alert, App, Button, Card, Form, Select, Upload } from 'antd';
import type { RcFile, UploadFile } from 'antd/es/upload/interface';
import PageHeader from '@/components/PageHeader';
import { useDataCenterStore } from '@/store/dataCenterStore';
import { useImportStore } from '@/store/importStore';
import { recordTypeMap } from '@/utils/dataCenterMaps';

interface ImportFormValues {
  projectId: string;
  templateId: string;
}

export default function DataImportPage() {
  const { message } = App.useApp();
  const [form] = Form.useForm<ImportFormValues>();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const navigate = useNavigate();
  const projects = useDataCenterStore((state) => state.projects);
  const projectLoading = useDataCenterStore((state) => state.projectLoading);
  const projectError = useDataCenterStore((state) => state.projectError);
  const fetchProjects = useDataCenterStore((state) => state.fetchProjects);
  const templates = useDataCenterStore((state) => state.templates);
  const templateLoading = useDataCenterStore((state) => state.templateLoading);
  const templateError = useDataCenterStore((state) => state.templateError);
  const fetchTemplates = useDataCenterStore((state) => state.fetchTemplates);
  const projectTemplates = useDataCenterStore((state) => state.projectTemplates);
  const projectTemplateLoading = useDataCenterStore((state) => state.projectTemplateLoading);
  const projectTemplateError = useDataCenterStore((state) => state.projectTemplateError);
  const fetchProjectTemplates = useDataCenterStore((state) => state.fetchProjectTemplates);
  const createAndParse = useImportStore((state) => state.createAndParse);
  const loading = useImportStore((state) => state.loading);
  const importError = useImportStore((state) => state.error);
  const projectId = Form.useWatch('projectId', form);
  const templateId = Form.useWatch('templateId', form);

  useEffect(() => {
    void fetchProjects({ page: 1, pageSize: 100, status: 'active' }).catch(() => undefined);
    void fetchTemplates({ page: 1, pageSize: 100 }).catch(() => undefined);
  }, [fetchProjects, fetchTemplates]);

  useEffect(() => {
    if (projectId) void fetchProjectTemplates(projectId).catch(() => undefined);
  }, [fetchProjectTemplates, projectId]);

  const enabledTemplateIds = useMemo(
    () => projectTemplates.filter((item) => item.projectId === projectId && item.isActive).map((item) => item.templateId),
    [projectId, projectTemplates],
  );
  const enabledTemplates = useMemo(
    () => templates.filter((item) => enabledTemplateIds.includes(item.id)),
    [enabledTemplateIds, templates],
  );
  const selectedTemplate = enabledTemplates.find((item) => item.id === templateId);

  const submit = async () => {
    const values = await form.validateFields();
    const file = fileList[0]?.originFileObj as RcFile | undefined;
    if (!file) {
      message.warning('请选择 .xls 或 .xlsx 文件');
      return;
    }
    const template = enabledTemplates.find((item) => item.id === values.templateId);
    if (!template) {
      message.warning('请选择当前项目已启用的模板');
      return;
    }
    const task = await createAndParse(file, {
      projectId: values.projectId,
      templateId: template.id,
      importType: template.recordType,
    });
    message.success(
      task.status === 'uploaded'
        ? '工作簿已检查，请选择工作表和表头'
        : task.status === 'parsing'
          ? '文件已进入后台解析，可在映射页查看进度'
          : '文件已解析，请确认字段映射',
    );
    navigate(`/data/import/${task.id}/mapping`);
  };

  return (
    <div>
      <PageHeader title="Excel导入" description="选择工作表、表头并确认字段映射" />
      {projectError ? <Alert type="error" showIcon message="项目列表加载失败" description={projectError} /> : null}
      {templateError || projectTemplateError ? <Alert type="error" showIcon message="模板列表加载失败" description={templateError || projectTemplateError} /> : null}
      {importError ? <Alert className="section-row" type="error" showIcon message="Excel 导入失败" description={importError} /> : null}
      <Card>
        <Form form={form} layout="vertical">
          <Form.Item label="项目" name="projectId" rules={[{ required: true, message: '请选择项目' }]}>
            <Select
              loading={projectLoading}
              options={projects.map((item) => ({ label: item.name, value: item.id }))}
              onChange={() => form.setFieldsValue({ templateId: undefined })}
            />
          </Form.Item>
          <Form.Item label="模板" name="templateId" rules={[{ required: true, message: '请选择模板' }]}>
            <Select
              loading={templateLoading || projectTemplateLoading}
              disabled={!projectId || enabledTemplates.length === 0}
              options={enabledTemplates.map((item) => ({ label: `${item.name} · ${recordTypeMap[item.recordType]}`, value: item.id }))}
            />
          </Form.Item>
          {selectedTemplate ? (
            <Alert className="section-row" type="info" showIcon message={`记录类型：${recordTypeMap[selectedTemplate.recordType]}`} />
          ) : null}
          {projectId && enabledTemplates.length === 0 ? (
            <Alert
              className="section-row"
              type="warning"
              showIcon
              message="当前项目暂无启用模板"
              action={<Button size="small" onClick={() => navigate(`/data/projects/${projectId}/structure`)}>查看项目结构</Button>}
            />
          ) : null}
          <Form.Item label="上传 Excel" required>
            <Upload.Dragger
              beforeUpload={() => false}
              fileList={fileList}
              onChange={({ fileList: next }) => setFileList(next.slice(-1))}
              accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              maxCount={1}
            >
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">选择 .xls 或 .xlsx 文件</p>
            </Upload.Dragger>
          </Form.Item>
          <Button type="primary" loading={loading} onClick={() => void submit().catch((error) => message.error(error instanceof Error ? error.message : '解析失败'))}>
            上传并解析
          </Button>
        </Form>
      </Card>
    </div>
  );
}
