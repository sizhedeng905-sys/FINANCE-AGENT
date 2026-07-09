import { useMemo, useState } from 'react';
import { App, Button, Card, DatePicker, Form, Input, InputNumber, Select, Space, Steps, Upload } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import PageHeader from '@/components/PageHeader';
import { useAuthStore } from '@/store/authStore';
import { useDataCenterStore } from '@/store/dataCenterStore';
import type { BusinessRecord, TemplateField } from '@/types/dataCenter';
import { recordTypeMap } from '@/utils/dataCenterMaps';

function renderField(item: TemplateField) {
  const name = item.field.fieldName;
  const rules = item.isRequired ? [{ required: true, message: `请填写${name}` }] : [];
  const common = { label: name, name: item.field.fieldKey, rules };
  if (!item.isVisible) return null;

  if (item.field.fieldType === 'number') {
    return <Form.Item key={item.id} {...common}><InputNumber className="full-width" addonAfter={item.field.unit} /></Form.Item>;
  }
  if (item.field.fieldType === 'money') {
    return <Form.Item key={item.id} {...common}><InputNumber className="full-width" addonBefore="¥" /></Form.Item>;
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
        <Upload.Dragger beforeUpload={() => false}>
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
  const [form] = Form.useForm();
  const [projectId, setProjectId] = useState<string>();
  const [templateId, setTemplateId] = useState<string>();
  const user = useAuthStore((state) => state.user);
  const projects = useDataCenterStore((state) => state.projects);
  const templates = useDataCenterStore((state) => state.templates);
  const templateFields = useDataCenterStore((state) => state.templateFields);
  const createRecord = useDataCenterStore((state) => state.createRecord);

  const project = projects.find((item) => item.id === projectId);
  const template = templates.find((item) => item.id === templateId);
  const fields = useMemo(
    () => templateFields.filter((item) => item.templateId === templateId).sort((a, b) => a.displayOrder - b.displayOrder),
    [templateFields, templateId],
  );
  const current = projectId ? (templateId ? 2 : 1) : 0;

  const submit = (status: BusinessRecord['status']) => {
    if (!project || !template) {
      message.warning('请先选择项目和模板');
      return;
    }
    form.validateFields().then((values) => {
      const amountField = fields.find((item) => item.field.semanticType === 'amount' || item.field.fieldType === 'money');
      const dateField = fields.find((item) => item.field.semanticType === 'date');
      const amount = Number(values[amountField?.field.fieldKey ?? 'amount'] ?? 0);
      const valuesList = fields.map((item, index) => ({
        id: `rv-manual-${Date.now()}-${index}`,
        recordId: '',
        fieldId: item.fieldId,
        fieldName: item.field.fieldName,
        value: item.field.fieldType === 'date' && values[item.field.fieldKey]?.format
          ? values[item.field.fieldKey].format('YYYY-MM-DD')
          : item.field.fieldType === 'file'
            ? (values[item.field.fieldKey] ?? []).map((file: { name: string }) => file.name)
            : values[item.field.fieldKey] ?? '',
      }));
      createRecord({
        projectId: project.id,
        projectName: project.name,
        templateId: template.id,
        templateName: template.name,
        recordType: template.recordType,
        recordDate: values[dateField?.field.fieldKey ?? 'date']?.format?.('YYYY-MM-DD') ?? '2026-07-09',
        amount,
        category: recordTypeMap[template.recordType],
        subCategory: template.name,
        description: values.remark ?? '手工补录记录',
        sourceType: 'manual',
        sourceId: 'manual',
        status,
        values: valuesList,
        attachments: [],
        createdBy: user?.name ?? '财务',
      });
      message.success(status === 'confirmed' ? '记录已确认入库' : '草稿已保存');
      form.resetFields();
    });
  };

  return (
    <div>
      <PageHeader title="手工补录" description="按模板动态生成表单，最终进入 BusinessRecord" />
      <Card>
        <Steps
          size="small"
          current={current}
          items={[{ title: '选择项目' }, { title: '选择模板' }, { title: '填写动态表单' }, { title: '保存/确认' }]}
        />
        <Form form={form} layout="vertical" className="section-row">
          <Form.Item label="项目" required>
            <Select
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
              value={templateId}
              onChange={(value) => {
                setTemplateId(value);
                form.resetFields();
              }}
              options={templates.map((item) => ({ label: `${item.name}（${recordTypeMap[item.recordType]}）`, value: item.id }))}
            />
          </Form.Item>
          {fields.map(renderField)}
          {templateId ? (
            <Form.Item label="补录说明" name="remark">
              <Input.TextArea rows={3} />
            </Form.Item>
          ) : null}
        </Form>
        <Space>
          <Button onClick={() => submit('draft')}>保存草稿</Button>
          <Button type="primary" onClick={() => submit('confirmed')}>确认入库</Button>
        </Space>
      </Card>
    </div>
  );
}
