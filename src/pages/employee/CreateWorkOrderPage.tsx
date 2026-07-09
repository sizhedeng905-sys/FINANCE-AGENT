import { useNavigate } from 'react-router-dom';
import { InboxOutlined, SaveOutlined, SendOutlined } from '@ant-design/icons';
import { App, Button, Card, Col, DatePicker, Form, Input, InputNumber, Row, Select, Space, Steps, Upload } from 'antd';
import type { Dayjs } from 'dayjs';
import PageHeader from '@/components/PageHeader';
import { useAuthStore } from '@/store/authStore';
import { useDataCenterStore } from '@/store/dataCenterStore';
import { useWorkOrderStore } from '@/store/workOrderStore';
import type { WorkOrder, WorkOrderStatus, WorkOrderType } from '@/types/workOrder';
import { currentTime } from '@/utils/format';
import { getStepByStatus } from '@/utils/statusMap';

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
  attachments?: { name: string }[];
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
  const user = useAuthStore((state) => state.user);
  const projects = useDataCenterStore((state) => state.projects);
  const createWorkOrder = useWorkOrderStore((state) => state.createWorkOrder);
  const type = Form.useWatch('type', form) ?? 'expense';
  const projectId = Form.useWatch('projectId', form);
  const current = projectId ? 1 : 0;

  const submit = async (values: FormValues, draft = false) => {
    if (!user) return;
    const project = projects.find((item) => item.id === values.projectId);
    if (!project) {
      message.warning('请选择项目');
      return;
    }

    const date = values.date?.format('YYYY-MM-DD') ?? '2026-07-09';
    const amount = num(values.amount);
    const status: WorkOrderStatus = draft ? 'draft' : 'finance_reviewing';
    const attachments = (values.attachments ?? []).map((item) => item.name);
    const id = `wo-${Date.now()}`;
    const base = {
      id,
      orderNo: `WO${date.replace(/-/g, '')}${String(Date.now()).slice(-4)}`,
      projectId: project.id,
      projectName: project.name,
      customerName: project.customerName,
      creatorName: user.name,
      creatorId: user.id,
      amount,
      income: 0,
      cost: amount,
      profit: 0,
      status,
      riskLevel: amount > 20000 ? ('high' as const) : amount > 8000 ? ('medium' as const) : ('low' as const),
      createdAt: currentTime(),
      updatedAt: currentTime(),
      currentStep: getStepByStatus(status),
      description: values.reason,
      attachments,
      aiSummary: 'AI 会在复核阶段自动分析该工单。',
      timeline: [
        {
          time: currentTime(),
          operator: user.name,
          role: user.role,
          action: draft ? '保存草稿' : '提交工单',
          comment: draft ? '员工保存草稿。' : '员工提交工单，等待财务审核。',
        },
      ],
    };

    let workOrder: WorkOrder;
    if (values.type === 'transport') {
      workOrder = {
        ...base,
        type: 'transport',
        vehiclePlate: values.vehiclePlate ?? '',
        driverName: values.driverName ?? '',
        vehicleOwnerType: 'outsourced',
        startLocation: values.startLocation ?? '',
        endLocation: values.endLocation ?? '',
        distance: 0,
        transportIncome: 0,
        fuelCost: 0,
        tollCost: 0,
        driverCost: 0,
        otherCost: amount,
        remark: values.remark,
      };
    } else if (values.type === 'expense') {
      workOrder = {
        ...base,
        type: 'expense',
        expenseType: values.expenseType ?? '其他',
        expenseAmount: amount,
        expenseDate: date,
        paymentMethod: '待财务确认',
        remark: values.remark,
      };
    } else {
      workOrder = {
        ...base,
        type: 'other',
        expenseType: values.spendingType ?? '其他支出',
        expenseAmount: amount,
        expenseDate: date,
        paymentMethod: values.payee ? `付款对象：${values.payee}` : '待财务确认',
        remark: values.remark,
      };
    }

    await createWorkOrder(workOrder);
    message.success(draft ? '草稿已保存' : '工单已提交，等待财务审核。');
    navigate('/work-orders/my');
  };

  return (
    <div>
      <PageHeader title="新建工单" description="提交申请、报销或业务支出，财务会在后续环节审核金额和资料" />
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
                <Select options={projects.map((item) => ({ label: item.name, value: item.id }))} />
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
            <Upload.Dragger beforeUpload={() => false} multiple accept="image/*,.pdf,.xls,.xlsx">
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">上传图片、PDF 或 Excel 附件</p>
            </Upload.Dragger>
          </Form.Item>
          <Form.Item label="备注" name="remark">
            <Input.TextArea rows={3} />
          </Form.Item>
          <div className="form-actions">
            <Space>
              <Button icon={<SaveOutlined />} onClick={() => form.validateFields().then((values) => submit(values, true))}>
                保存草稿
              </Button>
              <Button type="primary" icon={<SendOutlined />} onClick={() => form.validateFields().then((values) => submit(values, false))}>
                提交审核
              </Button>
            </Space>
          </div>
        </Form>
      </Card>
    </div>
  );
}
