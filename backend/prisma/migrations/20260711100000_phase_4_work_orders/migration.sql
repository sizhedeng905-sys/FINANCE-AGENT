CREATE TYPE "WorkOrderType" AS ENUM ('transport', 'expense', 'other');
CREATE TYPE "WorkOrderStatus" AS ENUM ('draft', 'finance_reviewing', 'finance_rejected', 'reviewer_reviewing', 'reviewer_rejected', 'ai_reviewing', 'ai_passed', 'ai_flagged', 'boss_pending', 'boss_rejected', 'completed', 'returned_for_supplement');
CREATE TYPE "RiskLevel" AS ENUM ('low', 'medium', 'high');
CREATE TYPE "NotificationType" AS ENUM ('urgent', 'audit', 'system', 'boss_approval');

CREATE TABLE "work_orders" (
  "id" TEXT NOT NULL,
  "order_no" TEXT NOT NULL,
  "type" "WorkOrderType" NOT NULL,
  "project_id" TEXT NOT NULL,
  "project_name" TEXT NOT NULL,
  "customer_name" TEXT,
  "creator_id" TEXT NOT NULL,
  "creator_name" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "income" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "profit" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "status" "WorkOrderStatus" NOT NULL DEFAULT 'finance_reviewing',
  "risk_level" "RiskLevel" NOT NULL DEFAULT 'low',
  "description" TEXT,
  "occurred_date" TIMESTAMP(3) NOT NULL,
  "extra_values" JSONB,
  "finance_opinion" TEXT,
  "reviewer_opinion" TEXT,
  "ai_summary" TEXT,
  "boss_opinion" TEXT,
  "urgent" BOOLEAN NOT NULL DEFAULT false,
  "urgent_reason" TEXT,
  "urgent_time" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "completed_at" TIMESTAMP(3),
  "generated_record_id" TEXT,
  CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "work_order_attachments" (
  "id" TEXT NOT NULL,
  "work_order_id" TEXT NOT NULL,
  "raw_file_id" TEXT NOT NULL,
  "uploaded_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "work_order_attachments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "work_order_timeline" (
  "id" TEXT NOT NULL,
  "work_order_id" TEXT NOT NULL,
  "operator_id" TEXT,
  "operator_name" TEXT,
  "role" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "comment" TEXT,
  "from_status" "WorkOrderStatus",
  "to_status" "WorkOrderStatus",
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "work_order_timeline_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "approvals" (
  "id" TEXT NOT NULL,
  "work_order_id" TEXT NOT NULL,
  "approver_id" TEXT,
  "approver_role" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "comment" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notifications" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "type" "NotificationType" NOT NULL,
  "sender_id" TEXT,
  "sender_name" TEXT,
  "target_role" "UserRole",
  "target_user_id" TEXT,
  "related_work_order_id" TEXT,
  "read" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "read_at" TIMESTAMP(3),
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "work_orders_order_no_key" ON "work_orders"("order_no");
CREATE UNIQUE INDEX "work_orders_generated_record_id_key" ON "work_orders"("generated_record_id");
CREATE INDEX "work_orders_creator_id_idx" ON "work_orders"("creator_id");
CREATE INDEX "work_orders_project_id_idx" ON "work_orders"("project_id");
CREATE INDEX "work_orders_status_idx" ON "work_orders"("status");
CREATE INDEX "work_orders_created_at_idx" ON "work_orders"("created_at");
CREATE UNIQUE INDEX "work_order_attachments_work_order_id_raw_file_id_key" ON "work_order_attachments"("work_order_id", "raw_file_id");
CREATE INDEX "work_order_attachments_raw_file_id_idx" ON "work_order_attachments"("raw_file_id");
CREATE INDEX "work_order_timeline_work_order_id_created_at_idx" ON "work_order_timeline"("work_order_id", "created_at");
CREATE INDEX "approvals_work_order_id_idx" ON "approvals"("work_order_id");
CREATE INDEX "approvals_approver_id_idx" ON "approvals"("approver_id");
CREATE INDEX "notifications_target_role_read_idx" ON "notifications"("target_role", "read");
CREATE INDEX "notifications_target_user_id_read_idx" ON "notifications"("target_user_id", "read");
CREATE INDEX "notifications_related_work_order_id_idx" ON "notifications"("related_work_order_id");

ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_generated_record_id_fkey" FOREIGN KEY ("generated_record_id") REFERENCES "business_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "work_order_attachments" ADD CONSTRAINT "work_order_attachments_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_order_timeline" ADD CONSTRAINT "work_order_timeline_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_order_timeline" ADD CONSTRAINT "work_order_timeline_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_related_work_order_id_fkey" FOREIGN KEY ("related_work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
