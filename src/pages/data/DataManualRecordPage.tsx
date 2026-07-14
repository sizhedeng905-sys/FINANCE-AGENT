import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, App, Button, Card, DatePicker, Form, Input, InputNumber, Select, Space, Steps, Upload } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import type { RcFile, UploadFile as AntUploadFile } from 'antd/es/upload/interface';
import dayjs from 'dayjs';
import { deleteFile, uploadFile } from '@/api/fileApi';
import PageHeader from '@/components/PageHeader';
import { useDataCenterStore } from '@/store/dataCenterStore';
import type { CreateRecordPayload, RecordValueInput, TemplateField } from '@/types/dataCenter';
import { recordTypeMap } from '@/utils/dataCenterMaps';

function renderField(item: TemplateField) {
  const name = item.field.fieldName;
  const rules = item.isRequired ? [{ required: true, message: `请填写${name}` }] : [];
  const common = { label: name, name: item.field.fieldKey, rules };
  if (!item.isVisible) return null;

  if (item.field.fieldType === 'number') {
    return <Form.Item key={item.id} {...common}><InputNumber stringMode className="full-width" addonAfter={item.field.unit} /></Form.Item>;
  }
  if (item.field.fieldType === 'money') {
    return <Form.Item key={item.id} {...common}><InputNumber stringMode precision={2} className="full-width" addonBefore="¥" /></Form.Item>;
  }
  if (item.field.fieldType === 'date') {
    return <Form.Item key={item.id} {...common}><DatePicker className="full-width" /></Form.Item>;
  }
  if (item.field.fieldType === 'select') {
    return <Form.Item key={item.id} {...common}><Select options={[{ label: '默认分类', value: '默认分类' }, { label: '其他', value: '其他' }]} /></Form.Item>;
  }
  if (item.field.fieldType === 'file') {
    return (
      <Form.Item key={item.id} {...common} valuePropName="fileList" getValueFromEvent={(event) => event?.fileList ?? []}>
        <Upload.Dragger
          beforeUpload={() => false}
          multiple
          maxCount={20}
          accept="image/*,.pdf,.xls,.xlsx,.csv,.doc,.docx"
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">上传附件</p>
        </Upload.Dragger>
      </Form.Item>
    );
  }
  if (item.field.fieldType === 'textarea') {
    return <Form.Item key={item.id} {...common}><Input.TextArea rows={3} /></Form.Item>;
  }
  return <Form.Item key={item.id} {...common}><Input /></Form.Item>;
}

export default function DataManualRecordPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [projectId, setProjectId] = useState<string>();
  const [templateId, setTemplateId] = useState<string>();
  const [submitting, setSubmitting] = useState<'draft' | 'confirm' | null>(null);
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
  const templateFields = useDataCenterStore((state) => state.templateFields);
  const templateFieldLoading = useDataCenterStore((state) => state.templateFieldLoading);
  const templateFieldError = useDataCenterStore((state) => state.templateFieldError);
  const fetchTemplateFields = useDataCenterStore((state) => state.fetchTemplateFields);
  const recordError = useDataCenterStore((state) => state.recordError);
  const createRecord = useDataCenterStore((state) => state.createRecord);
  const confirmRecord = useDataCenterStore((state) => state.confirmRecord);

  useEffect(() => {
    void fetchProjects({ page: 1, pageSize: 100, status: 'active' }).catch(() => undefined);
    void fetchTemplates({ page: 1, pageSize: 100 }).catch(() => undefined);
  }, [fetchProjects, fetchTemplates]);

  useEffect(() => {
    if (templateId) void fetchTemplateFields(templateId).catch(() => undefined);
  }, [fetchTemplateFields, templateId]);

  useEffect(() => {
    if (projectId) void fetchProjectTemplates(projectId).catch(() => undefined);
  }, [fetchProjectTemplates, projectId]);

  const project = projects.find((item) => item.id === projectId);
  const template = templates.find((item) => item.id === templateId);
  const enabledTemplateIds = useMemo(
    () => projectTemplates.filter((item) => item.projectId === projectId && item.isActive).map((item) => item.templateId),
    [projectId, projectTemplates],
  );
  const enabledTemplates = useMemo(
    () => templates.filter((item) => enabledTemplateIds.includes(item.id)),
    [enabledTemplateIds, templates],
  );
  const fields = useMemo(
    () => templateFields.filter((item) => item.templateId === templateId).sort((a, b) => a.displayOrder - b.displayOrder),
    [templateFields, templateId],
  );
  const current = projectId ? (templateId ? 2 : 1) : 0;

  const submit = async (shouldConfirm: boolean) => {
    if (!project || !template) {
      message.warning('请先选择项目和模板');
      return;
    }

    setSubmitting(shouldConfirm ? 'confirm' : 'draft');
    const uploadedFileIds: string[] = [];
    let createdRecordId: string | undefined;
    try {
      const values = shouldConfirm ? await form.validateFields() : form.getFieldsValue(true);
      const uploadedByField = new Map<string, string[]>();
      for (const item of fields.filter((field) => field.field.fieldType === 'file')) {
        const selected = (values[item.field.fieldKey] ?? []) as AntUploadFile[];
        const fieldFileIds: string[] = [];
        for (const selectedFile of selected) {
          const file = selectedFile.originFileObj;
          if (!file) continue;
          const uploaded = await uploadFile(file as RcFile, project.id);
          uploadedFileIds.push(uploaded.id);
          fieldFileIds.push(uploaded.id);
        }
        uploadedByField.set(item.field.fieldKey, fieldFileIds);
      }
      const amountField = fields.find((item) => item.fieldId === template.primaryAmountFieldId);
      const dateField = fields.find((item) => item.fieldId === template.primaryDateFieldId);
      if (!amountField || !dateField) throw new Error('模板尚未配置主金额字段或主日期字段');
      const amount = String(values[amountField.field.fieldKey] ?? '').trim();
      if (!/^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/.test(amount) || /^0(?:\.0{1,2})?$/.test(amount)) {
        throw new Error('主金额必须是大于 0 且最多两位小数的金额');
      }
      const valuesList = fields.reduce<RecordValueInput[]>((result, item) => {
        const rawValue = values[item.field.fieldKey];
        const value = item.field.fieldType === 'date' && rawValue?.format
          ? rawValue.format('YYYY-MM-DD')
          : item.field.fieldType === 'file'
            ? uploadedByField.get(item.field.fieldKey) ?? []
            : rawValue;
        const isEmpty = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
        if (!isEmpty) result.push({ fieldId: item.fieldId, value });
        return result;
      }, []);
      const attachments = valuesList.flatMap((value) => Array.isArray(value.value) ? value.value : []);
      const payload: CreateRecordPayload = {
        projectId: project.id,
        templateId: template.id,
        recordType: template.recordType,
        recordDate: values[dateField.field.fieldKey]?.format?.('YYYY-MM-DD') ?? dayjs().format('YYYY-MM-DD'),
        amount,
        category: template.accountingDirection === 'income' ? '收入' : '成本',
        subCategory: template.name,
        description: values.remark ?? '手工补录记录',
        sourceType: 'manual',
        sourceId: 'manual',
        status: shouldConfirm ? 'pending_confirm' : 'draft',
        values: valuesList,
        attachments,
      };
      const created = await createRecord(payload);
      createdRecordId = created.id;
      if (shouldConfirm) await confirmRecord(created.id);
      message.success(shouldConfirm ? '记录已确认入库' : '草稿已保存');
      form.resetFields();
      if (shouldConfirm) {
        navigate(`/data/projects/${project.id}/structure`);
      }
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'errorFields' in error) {
        message.warning('请完成必填字段后再确认入库');
      } else {
        if (!createdRecordId && uploadedFileIds.length) {
          await Promise.allSettled(uploadedFileIds.map((id) => deleteFile(id, '手工补录创建失败清理')));
        }
        message.error(error instanceof Error ? error.message : '手工补录失败');
      }
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div>
      <PageHeader title="手工补录" description="按模板动态生成表单，最终进入 BusinessRecord" />
      {projectError ? <Alert type="error" showIcon message="项目列表加载失败" description={projectError} /> : null}
      {templateError || projectTemplateError ? <Alert type="error" showIcon message="模板列表加载失败" description={templateError || projectTemplateError} /> : null}
      {templateFieldError ? <Alert type="error" showIcon message="模板字段加载失败" description={templateFieldError} /> : null}
      {recordError ? <Alert type="error" showIcon message="手工补录失败" description={recordError} /> : null}
      <Card>
        <Steps
          size="small"
          current={current}
          items={[{ title: '选择项目' }, { title: '选择模板' }, { title: '填写动态表单' }, { title: '保存/确认' }]}
        />
        <Form form={form} layout="vertical" className="section-row">
          <Form.Item label="项目" required>
            <Select
              loading={projectLoading}
              value={projectId}
              onChange={(value) => {
                setProjectId(value);
                setTemplateId(undefined);
                form.resetFields();
              }}
              options={projects.filter((item) => item.status === 'active').map((item) => ({ label: item.name, value: item.id }))}
            />
          </Form.Item>
          <Form.Item label="模板" required>
            <Select
              loading={templateLoading || templateFieldLoading || projectTemplateLoading}
              value={templateId}
              onChange={(value) => {
                setTemplateId(value);
                form.resetFields();
              }}
              disabled={!projectId || enabledTemplates.length === 0}
              options={enabledTemplates.map((item) => ({ label: `${item.name}（${recordTypeMap[item.recordType]}）`, value: item.id }))}
            />
          </Form.Item>
          {projectId && enabledTemplates.length === 0 ? (
            <Alert
              className="section-row"
              type="warning"
              showIcon
              message="当前项目暂无启用模板，请先在项目结构中启用模板。"
              action={<Button size="small" onClick={() => navigate(`/data/projects/${projectId}/structure`)}>查看项目结构</Button>}
            />
          ) : null}
          {fields.map(renderField)}
          {templateId ? (
            <Form.Item label="补录说明" name="remark">
              <Input.TextArea rows={3} />
            </Form.Item>
          ) : null}
        </Form>
        <Space>
          <Button loading={submitting === 'draft'} disabled={submitting !== null} onClick={() => void submit(false)}>保存草稿</Button>
          <Button type="primary" loading={submitting === 'confirm'} disabled={submitting !== null} onClick={() => void submit(true)}>确认入库</Button>
        </Space>
      </Card>
    </div>
  );
}
