import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { InboxOutlined } from '@ant-design/icons';
import { Alert, App, Button, Card, Form, InputNumber, Select, Space, Upload } from 'antd';
import type { RcFile, UploadFile } from 'antd/es/upload/interface';
import PageHeader from '@/components/PageHeader';
import { useDataCenterStore } from '@/store/dataCenterStore';
import { useOCRStore } from '@/store/ocrStore';
import { recordTypeMap } from '@/utils/dataCenterMaps';

interface FormValues {
  projectId: string;
  templateId: string;
  pageStart?: number;
  pageEnd?: number;
}

export default function DataOcrPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [form] = Form.useForm<FormValues>();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);
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
  const uploadAndRun = useOCRStore((state) => state.uploadAndRun);
  const loading = useOCRStore((state) => state.loading);
  const ocrError = useOCRStore((state) => state.error);
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
  const selectedFile = fileList[0];
  const isPdf = selectedFile?.type === 'application/pdf' || selectedFile?.name.toLowerCase().endsWith('.pdf');

  const submit = async () => {
    const values = await form.validateFields();
    const file = fileList[0]?.originFileObj as RcFile | undefined;
    if (!file) {
      message.warning('请选择 PDF 或图片票据');
      return;
    }
    const template = enabledTemplates.find((item) => item.id === values.templateId);
    if (!template) {
      message.warning('请选择当前项目已启用的模板');
      return;
    }
    setUploading(true);
    try {
      const task = await uploadAndRun(file, {
        projectId: values.projectId,
        templateId: template.id,
        pageStart: values.pageStart,
        pageEnd: values.pageEnd,
      });
      message.success('OCR 识别完成，请人工核对字段');
      navigate(`/data/ocr/${task.id}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="OCR票据识别"
        description="PDF或图片识别后必须人工确认"
        extra={<Button onClick={() => navigate('/data/ocr-tasks')}>查看任务</Button>}
      />
      {projectError ? <Alert type="error" showIcon message="项目列表加载失败" description={projectError} /> : null}
      {templateError || projectTemplateError ? <Alert type="error" showIcon message="模板列表加载失败" description={templateError || projectTemplateError} /> : null}
      {ocrError ? <Alert className="section-row" type="error" showIcon message="OCR 请求失败" description={ocrError} /> : null}
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
          {selectedTemplate ? <Alert className="section-row" type="info" showIcon message={`入库类型：${recordTypeMap[selectedTemplate.recordType]}`} /> : null}
          {projectId && enabledTemplates.length === 0 ? <Alert className="section-row" type="warning" showIcon message="当前项目暂无启用模板" /> : null}
          <Form.Item label="票据原文件" required>
            <Upload.Dragger
              beforeUpload={() => false}
              fileList={fileList}
              onChange={({ fileList: next }) => {
                const latest = next.slice(-1);
                setFileList(latest);
                const nextFile = latest[0];
                const nextIsPdf = nextFile?.type === 'application/pdf' || nextFile?.name.toLowerCase().endsWith('.pdf');
                if (!nextIsPdf) form.setFieldsValue({ pageStart: undefined, pageEnd: undefined });
              }}
              accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
              maxCount={1}
            >
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">选择 PDF、PNG、JPEG 或 WebP 票据</p>
            </Upload.Dragger>
          </Form.Item>
          {isPdf ? (
            <Form.Item label="PDF 页段（可选）">
              <Space.Compact>
                <Form.Item
                  name="pageStart"
                  noStyle
                  dependencies={['pageEnd']}
                  rules={[{
                    validator: (_, value) => {
                      const end = form.getFieldValue('pageEnd') as number | undefined;
                      return end !== undefined && value === undefined
                        ? Promise.reject(new Error('请输入起始页'))
                        : Promise.resolve();
                    },
                  }]}
                >
                  <InputNumber min={1} max={500} precision={0} placeholder="起始页" />
                </Form.Item>
                <Form.Item
                  name="pageEnd"
                  noStyle
                  dependencies={['pageStart']}
                  rules={[{
                    validator: (_, value) => {
                      const start = form.getFieldValue('pageStart') as number | undefined;
                      if (start !== undefined && value === undefined) return Promise.reject(new Error('请输入结束页'));
                      if (start !== undefined && value !== undefined && value < start) return Promise.reject(new Error('结束页不能小于起始页'));
                      if (start !== undefined && value !== undefined && value - start + 1 > 20) return Promise.reject(new Error('单次最多识别 20 页'));
                      return Promise.resolve();
                    },
                  }]}
                >
                  <InputNumber min={1} max={500} precision={0} placeholder="结束页" />
                </Form.Item>
              </Space.Compact>
            </Form.Item>
          ) : null}
          <Button type="primary" loading={uploading || loading} onClick={() => void submit().catch((error) => message.error(error instanceof Error ? error.message : 'OCR识别失败'))}>
            上传并识别
          </Button>
        </Form>
      </Card>
    </div>
  );
}
