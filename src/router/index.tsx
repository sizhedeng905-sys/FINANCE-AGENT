import { Navigate, Route, Routes } from 'react-router-dom';
import MainLayout from '@/layouts/MainLayout';
import LoginPage from '@/pages/login/LoginPage';
import EmployeeHome from '@/pages/employee/EmployeeHome';
import CreateWorkOrderPage from '@/pages/employee/CreateWorkOrderPage';
import MyWorkOrdersPage from '@/pages/employee/MyWorkOrdersPage';
import FinanceHome from '@/pages/finance/FinanceHome';
import FinanceAuditPage from '@/pages/finance/FinanceAuditPage';
import FinanceAnomaliesPage from '@/pages/finance/FinanceAnomaliesPage';
import FinanceReportsPage from '@/pages/finance/FinanceReportsPage';
import ReviewerHome from '@/pages/reviewer/ReviewerHome';
import ReviewerTasksPage from '@/pages/reviewer/ReviewerTasksPage';
import ReviewerHistoryPage from '@/pages/reviewer/ReviewerHistoryPage';
import ReviewerTaskDetailPage from '@/pages/reviewer/ReviewerTaskDetailPage';
import BossHome from '@/pages/boss/BossHome';
import BossApprovalPage from '@/pages/boss/BossApprovalPage';
import BossApprovalDetailPage from '@/pages/boss/BossApprovalDetailPage';
import BossAIPage from '@/pages/boss/BossAIPage';
import BossReportsPage from '@/pages/boss/BossReportsPage';
import BossProjectsPage from '@/pages/boss/BossProjectsPage';
import WorkOrderDetailPage from '@/pages/common/WorkOrderDetailPage';
import NotFoundPage from '@/pages/common/NotFoundPage';
import DataProjectsPage from '@/pages/data/DataProjectsPage';
import DataTemplatesPage from '@/pages/data/DataTemplatesPage';
import DataTemplateEditPage from '@/pages/data/DataTemplateEditPage';
import DataFieldsPage from '@/pages/data/DataFieldsPage';
import DataManualRecordPage from '@/pages/data/DataManualRecordPage';
import DataImportPage from '@/pages/data/DataImportPage';
import DataImportMappingPage from '@/pages/data/DataImportMappingPage';
import DataImportConfirmPage from '@/pages/data/DataImportConfirmPage';
import DataImportTasksPage from '@/pages/data/DataImportTasksPage';
import DataRecordsPage from '@/pages/data/DataRecordsPage';
import DataFieldSuggestionsPage from '@/pages/data/DataFieldSuggestionsPage';
import DataProjectStructurePage from '@/pages/data/DataProjectStructurePage';
import DataOcrPage from '@/pages/data/DataOcrPage';
import DataOcrTasksPage from '@/pages/data/DataOcrTasksPage';
import DataOcrDetailPage from '@/pages/data/DataOcrDetailPage';
import UserManagementPage from '@/pages/system/UserManagementPage';
import { useAuthStore } from '@/store/authStore';
import ProtectedRoute from './ProtectedRoute';
import { getDefaultPath } from './roleMenus';

export default function AppRouter() {
  const user = useAuthStore((state) => state.user);

  return (
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
  );
}
