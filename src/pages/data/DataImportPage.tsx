import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Button, Card, Form, Select, Upload } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import PageHeader from '@/components/PageHeader';
import { useAuthStore } from '@/store/authStore';
import { useDataCenterStore } from '@/store/dataCenterStore';
import type { ImportTask } from '@/types/dataCenter';
import { recordTypeMap } from '@/utils/dataCenterMaps';

export default function DataImportPage() {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const projects = useDataCenterStore((state) => state.projects);
  const templates = useDataCenterStore((state) => state.templates);
  const createImportTask = useDataCenterStore((state) => state.createImportTask);
  const [fileName, setFileName] = useState('导入数据.xlsx');

  const submit = () => {
    form.validateFields().then((values) => {
      const task = createImportTask({
        projectId: values.projectId,
        templateId: values.templateId,
        importType: values.importType,
        fileName,
        uploadedBy: user?.name ?? '财务',
      });
      message.success('导入任务已创建，进入字段映射');
      navigate(`/data/import/${task.id}/mapping`);
    });
  };

  return (
    <div>
      <PageHeader title="Excel导入" description="上传文件并进入字段映射流程，当前使用 mock 表头解析" />
      <Card>
        <Form form={form} layout="vertical">
          <Form.Item label="项目" name="projectId" rules={[{ required: true }]}>
            <Select options={projects.map((item) => ({ label: item.name, value: item.id }))} />
          </Form.Item>
          <Form.Item label="数据类型" name="importType" rules={[{ required: true }]}>
            <Select options={Object.entries(recordTypeMap).filter(([value]) => value !== 'reimbursement').map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item label="模板" name="templateId" rules={[{ required: true }]}>
            <Select options={templates.map((item) => ({ label: item.name, value: item.id }))} />
          </Form.Item>
          <Form.Item label="上传Excel">
            <Upload.Dragger
              beforeUpload={(file) => {
                setFileName(file.name);
                return false;
              }}
              maxCount={1}
            >
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">点击或拖拽 Excel 文件到这里</p>
              <p className="ant-upload-hint">当前阶段使用 mock 表头和前5行示例数据</p>
            </Upload.Dragger>
          </Form.Item>
          <Button type="primary" onClick={submit}>开始解析</Button>
        </Form>
      </Card>
    </div>
  );
}
