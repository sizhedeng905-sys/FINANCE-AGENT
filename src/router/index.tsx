import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Spin } from 'antd';
import MainLayout from '@/layouts/MainLayout';
import { useAuthStore } from '@/store/authStore';
import ProtectedRoute from './ProtectedRoute';
import { getDefaultPath } from './roleMenus';

const LoginPage = lazy(() => import('@/pages/login/LoginPage'));
const EmployeeHome = lazy(() => import('@/pages/employee/EmployeeHome'));
const CreateWorkOrderPage = lazy(() => import('@/pages/employee/CreateWorkOrderPage'));
const MyWorkOrdersPage = lazy(() => import('@/pages/employee/MyWorkOrdersPage'));
const FinanceHome = lazy(() => import('@/pages/finance/FinanceHome'));
const FinanceAuditPage = lazy(() => import('@/pages/finance/FinanceAuditPage'));
const FinanceAnomaliesPage = lazy(() => import('@/pages/finance/FinanceAnomaliesPage'));
const FinanceReportsPage = lazy(() => import('@/pages/finance/FinanceReportsPage'));
const ReviewerHome = lazy(() => import('@/pages/reviewer/ReviewerHome'));
const ReviewerTasksPage = lazy(() => import('@/pages/reviewer/ReviewerTasksPage'));
const ReviewerHistoryPage = lazy(() => import('@/pages/reviewer/ReviewerHistoryPage'));
const ReviewerTaskDetailPage = lazy(() => import('@/pages/reviewer/ReviewerTaskDetailPage'));
const BossHome = lazy(() => import('@/pages/boss/BossHome'));
const BossApprovalPage = lazy(() => import('@/pages/boss/BossApprovalPage'));
const BossApprovalDetailPage = lazy(() => import('@/pages/boss/BossApprovalDetailPage'));
const BossAIPage = lazy(() => import('@/pages/boss/BossAIPage'));
const BossReportsPage = lazy(() => import('@/pages/boss/BossReportsPage'));
const BossProjectsPage = lazy(() => import('@/pages/boss/BossProjectsPage'));
const WorkOrderDetailPage = lazy(() => import('@/pages/common/WorkOrderDetailPage'));
const NotFoundPage = lazy(() => import('@/pages/common/NotFoundPage'));
const DataProjectsPage = lazy(() => import('@/pages/data/DataProjectsPage'));
const DataTemplatesPage = lazy(() => import('@/pages/data/DataTemplatesPage'));
const DataTemplateEditPage = lazy(() => import('@/pages/data/DataTemplateEditPage'));
const DataFieldsPage = lazy(() => import('@/pages/data/DataFieldsPage'));
const DataManualRecordPage = lazy(() => import('@/pages/data/DataManualRecordPage'));
const DataImportPage = lazy(() => import('@/pages/data/DataImportPage'));
const DataImportMappingPage = lazy(() => import('@/pages/data/DataImportMappingPage'));
const DataImportConfirmPage = lazy(() => import('@/pages/data/DataImportConfirmPage'));
const DataImportTasksPage = lazy(() => import('@/pages/data/DataImportTasksPage'));
const DataRecordsPage = lazy(() => import('@/pages/data/DataRecordsPage'));
const DataFieldSuggestionsPage = lazy(() => import('@/pages/data/DataFieldSuggestionsPage'));
const DataProjectStructurePage = lazy(() => import('@/pages/data/DataProjectStructurePage'));
const DataOcrPage = lazy(() => import('@/pages/data/DataOcrPage'));
const DataOcrTasksPage = lazy(() => import('@/pages/data/DataOcrTasksPage'));
const DataOcrDetailPage = lazy(() => import('@/pages/data/DataOcrDetailPage'));
const UserManagementPage = lazy(() => import('@/pages/system/UserManagementPage'));

export default function AppRouter() {
  const user = useAuthStore((state) => state.user);

  return (
    <Suspense fallback={<div className="app-route-loading"><Spin size="large" /></div>}>
      <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to={getDefaultPath(user.role)} replace /> : <LoginPage />}
      />
      <Route element={<ProtectedRoute />}>
        <Route element={<MainLayout />}>
          <Route path="/" element={<Navigate to={user ? getDefaultPath(user.role) : '/login'} replace />} />
          <Route path="/employee/home" element={<EmployeeHome />} />
          <Route path="/work-orders/create" element={<CreateWorkOrderPage />} />
          <Route path="/work-orders/my" element={<MyWorkOrdersPage />} />
          <Route path="/work-orders/:id" element={<WorkOrderDetailPage />} />

          <Route path="/finance/home" element={<FinanceHome />} />
          <Route path="/finance/audit" element={<FinanceAuditPage />} />
          <Route path="/finance/anomalies" element={<FinanceAnomaliesPage />} />
          <Route path="/finance/reports" element={<FinanceReportsPage />} />
          <Route path="/system/users" element={<UserManagementPage />} />

          <Route path="/reviewer/home" element={<ReviewerHome />} />
          <Route path="/reviewer/tasks" element={<ReviewerTasksPage />} />
          <Route path="/reviewer/history" element={<ReviewerHistoryPage />} />
          <Route path="/reviewer/tasks/:id" element={<ReviewerTaskDetailPage />} />

          <Route path="/boss/home" element={<BossHome />} />
          <Route path="/boss/approval" element={<BossApprovalPage />} />
          <Route path="/boss/approval/:id" element={<BossApprovalDetailPage />} />
          <Route path="/boss/ai" element={<BossAIPage />} />
          <Route path="/boss/reports" element={<BossReportsPage />} />
          <Route path="/boss/projects" element={<BossProjectsPage />} />
          <Route path="/boss/system/users" element={<UserManagementPage />} />
          <Route path="/boss/data/projects" element={<DataProjectsPage readOnly />} />
          <Route path="/boss/data/projects/:id/structure" element={<DataProjectStructurePage readOnly />} />
          <Route path="/boss/data/records" element={<DataRecordsPage readOnly />} />

          <Route path="/data/projects" element={<DataProjectsPage />} />
          <Route path="/data/projects/:id/structure" element={<DataProjectStructurePage />} />
          <Route path="/data/templates" element={<DataTemplatesPage />} />
          <Route path="/data/templates/:id" element={<DataTemplateEditPage />} />
          <Route path="/data/fields" element={<DataFieldsPage />} />
          <Route path="/data/manual-record" element={<DataManualRecordPage />} />
          <Route path="/data/import" element={<DataImportPage />} />
          <Route path="/data/import/:id/mapping" element={<DataImportMappingPage />} />
          <Route path="/data/import/:id/confirm" element={<DataImportConfirmPage />} />
          <Route path="/data/import-tasks" element={<DataImportTasksPage />} />
          <Route path="/data/records" element={<DataRecordsPage />} />
          <Route path="/data/field-suggestions" element={<DataFieldSuggestionsPage />} />
          <Route path="/data/ocr" element={<DataOcrPage />} />
          <Route path="/data/ocr-tasks" element={<DataOcrTasksPage />} />
          <Route path="/data/ocr/:id" element={<DataOcrDetailPage />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
