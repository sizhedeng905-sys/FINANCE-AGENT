import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { InboxOutlined, SaveOutlined, SendOutlined } from '@ant-design/icons';
import { Alert, App, Button, Card, Col, DatePicker, Form, Input, InputNumber, Row, Select, Space, Steps, Upload } from 'antd';
import type { RcFile, UploadFile } from 'antd/es/upload/interface';
import type { Dayjs } from 'dayjs';
import PageHeader from '@/components/PageHeader';
import { uploadFile } from '@/api/fileApi';
import { useDataCenterStore } from '@/store/dataCenterStore';
import { useWorkOrderStore } from '@/store/workOrderStore';
import type { CreateWorkOrderPayload, WorkOrderType } from '@/types/workOrder';

interface FormValues {
  type: WorkOrderType;
  projectId: string;
  amount: number;
  reason: string;
  date?: Dayjs;
  expenseType?: string;
  vehiclePlate?: string;
  driverName?: string;
  startLocation?: string;
  endLocation?: string;
  spendingType?: string;
  payee?: string;
  remark?: string;
  attachments?: UploadFile[];
}

const typeOptions = [
  { label: '报销申请', value: 'expense' },
  { label: '运输相关费用', value: 'transport' },
  { label: '其他支出', value: 'other' },
];

const expenseTypeOptions = ['人工', '运输', '场地', '设备', '办公', '其他'].map((item) => ({ label: item, value: item }));

const num = (value?: number) => Number(value ?? 0);

export default function CreateWorkOrderPage() {
  const [form] = Form.useForm<FormValues>();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const projects = useDataCenterStore((state) => state.projects);
  const projectLoading = useDataCenterStore((state) => state.projectLoading);
  const projectError = useDataCenterStore((state) => state.projectError);
  const fetchProjects = useDataCenterStore((state) => state.fetchProjects);
  const createWorkOrder = useWorkOrderStore((state) => state.createWorkOrder);
  const fetchWorkOrder = useWorkOrderStore((state) => state.fetchWorkOrder);
  const submitWorkOrder = useWorkOrderStore((state) => state.submitWorkOrder);
  const workOrderLoading = useWorkOrderStore((state) => state.loading);
  const workOrderError = useWorkOrderStore((state) => state.error);
  const type = Form.useWatch('type', form) ?? 'expense';
  const projectId = Form.useWatch('projectId', form);
  const current = projectId ? 1 : 0;

  useEffect(() => {
    void fetchProjects({ page: 1, pageSize: 100, status: 'active' }).catch(() => undefined);
  }, [fetchProjects]);

  const submit = async (values: FormValues, draft = false) => {
    const project = projects.find((item) => item.id === values.projectId);
    if (!project) {
      message.warning('请选择项目');
      return;
    }

    const files = (values.attachments ?? [])
      .map((item) => item.originFileObj)
      .filter((item): item is RcFile => Boolean(item));
    const extraValues: Record<string, unknown> = {
      remark: values.remark,
    };
    if (values.type === 'transport') {
      Object.assign(extraValues, {
        vehiclePlate: values.vehiclePlate,
        driverName: values.driverName,
        startLocation: values.startLocation,
        endLocation: values.endLocation,
      });
    } else if (values.type === 'expense') {
      extraValues.expenseType = values.expenseType;
      extraValues.costCategory = values.expenseType;
    } else {
      extraValues.expenseType = values.spendingType;
      extraValues.costCategory = values.spendingType;
      extraValues.payee = values.payee;
    }
    Object.keys(extraValues).forEach((key) => {
      if (extraValues[key] === undefined || extraValues[key] === '') delete extraValues[key];
    });
    const payload: CreateWorkOrderPayload = {
      type: values.type,
      projectId: project.id,
      amount: values.amount === undefined ? undefined : num(values.amount),
      description: values.reason?.trim() || undefined,
      occurredDate: values.date?.format('YYYY-MM-DD'),
      extraValues,
    };
    const created = await createWorkOrder(payload, false);
    try {
      for (const file of files) {
        await uploadFile(file, project.id, created.id);
      }
      if (files.length) await fetchWorkOrder(created.id);
    } catch (error) {
      message.error(`工单草稿已保存，但附件上传失败：${error instanceof Error ? error.message : '未知错误'}`);
      navigate(`/work-orders/${created.id}`);
      return;
    }
    if (!draft) await submitWorkOrder(created.id);
    message.success(draft ? '草稿已保存' : '工单已提交，等待财务审核。');
    navigate('/work-orders/my');
  };

  return (
    <div>
      <PageHeader title="新建工单" description="提交申请、报销或业务支出，财务会在后续环节审核金额和资料" />
      {projectError ? <Alert type="error" showIcon message="可用项目加载失败" description={projectError} /> : null}
      {workOrderError ? <Alert type="error" showIcon message="工单操作失败" description={workOrderError} /> : null}
      <Card>
        <Steps
          size="small"
          current={current}
          items={[{ title: '选择工单类型' }, { title: '填写基础信息' }, { title: '提交审核' }]}
        />
        <Form form={form} layout="vertical" className="section-row" initialValues={{ type: 'expense' }}>
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item label="工单类型" name="type" rules={[{ required: true }]}>
                <Select options={typeOptions} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="项目" name="projectId" rules={[{ required: true, message: '请选择项目' }]}>
                <Select loading={projectLoading} options={projects.map((item) => ({ label: item.name, value: item.id }))} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="发生日期" name="date" rules={[{ required: true, message: '请选择发生日期' }]}>
                <DatePicker className="full-width" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="申请金额（元）" name="amount" rules={[{ required: true, message: '请输入申请金额' }]}>
                <InputNumber min={0} addonBefore="¥" className="full-width" />
              </Form.Item>
            </Col>
          </Row>

          {type === 'expense' ? (
            <Row gutter={16}>
              <Col xs={24} md={8}>
                <Form.Item label="费用类型" name="expenseType" rules={[{ required: true, message: '请选择费用类型' }]}>
                  <Select options={expenseTypeOptions} />
                </Form.Item>
              </Col>
            </Row>
          ) : null}

          {type === 'transport' ? (
            <Row gutter={16}>
              <Col xs={24} md={6}><Form.Item label="车牌号" name="vehiclePlate"><Input /></Form.Item></Col>
              <Col xs={24} md={6}><Form.Item label="司机" name="driverName"><Input /></Form.Item></Col>
              <Col xs={24} md={6}><Form.Item label="起点" name="startLocation"><Input /></Form.Item></Col>
              <Col xs={24} md={6}><Form.Item label="终点" name="endLocation"><Input /></Form.Item></Col>
            </Row>
          ) : null}

          {type === 'other' ? (
            <Row gutter={16}>
              <Col xs={24} md={8}>
                <Form.Item label="支出类型" name="spendingType" rules={[{ required: true, message: '请输入支出类型' }]}>
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item label="付款对象" name="payee">
                  <Input />
                </Form.Item>
              </Col>
            </Row>
          ) : null}

          <Form.Item label="事由说明" name="reason" rules={[{ required: true, message: '请填写事由说明' }]}>
            <Input.TextArea rows={4} placeholder="请说明这笔申请或支出的业务背景" />
          </Form.Item>
          <Form.Item label="附件上传" name="attachments" valuePropName="fileList" getValueFromEvent={(event) => event?.fileList ?? []}>
            <Upload.Dragger beforeUpload={() => false} multiple maxCount={20} accept="image/*,.pdf,.xls,.xlsx,.csv,.doc,.docx">
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">上传图片、PDF 或 Excel 附件</p>
            </Upload.Dragger>
          </Form.Item>
          <Form.Item label="备注" name="remark">
            <Input.TextArea rows={3} />
          </Form.Item>
          <div className="form-actions">
            <Space>
              <Button
                icon={<SaveOutlined />}
                loading={workOrderLoading}
                onClick={() => {
                  const values = form.getFieldsValue(true);
                  if (!values.type || !values.projectId) {
                    message.warning('保存草稿前请选择工单类型和项目');
                    return;
                  }
                  void submit(values, true).catch((error) => message.error(error instanceof Error ? error.message : '保存草稿失败'));
                }}
              >
                保存草稿
              </Button>
              <Button
                type="primary"
                icon={<SendOutlined />}
                loading={workOrderLoading}
                onClick={() => form.validateFields()
                  .then((values) => submit(values, false))
                  .catch((error) => {
                    const isFormValidationError = typeof error === 'object' && error !== null && 'errorFields' in error;
                    if (!isFormValidationError) message.error(error instanceof Error ? error.message : '提交工单失败');
                  })}
              >
                提交审核
              </Button>
            </Space>
          </div>
        </Form>
      </Card>
    </div>
  );
}
