CREATE TYPE "AnomalyStatus" AS ENUM ('open', 'resolved', 'ignored');

CREATE TABLE "risk_rules" (
  "id" TEXT NOT NULL,
  "rule_key" TEXT NOT NULL,
  "rule_name" TEXT NOT NULL,
  "rule_type" TEXT NOT NULL,
  "target_type" TEXT NOT NULL DEFAULT 'work_order',
  "severity" "RiskLevel" NOT NULL DEFAULT 'medium',
  "condition_json" JSONB NOT NULL,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "risk_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rule_run_results" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "rule_id" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "project_id" TEXT,
  "work_order_id" TEXT,
  "passed" BOOLEAN NOT NULL,
  "risk_level" "RiskLevel",
  "result_json" JSONB NOT NULL DEFAULT '{}',
  "run_by" TEXT NOT NULL DEFAULT 'system',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rule_run_results_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_anomalies" (
  "id" TEXT NOT NULL,
  "anomaly_type" TEXT NOT NULL,
  "rule_id" TEXT NOT NULL,
  "project_id" TEXT,
  "work_order_id" TEXT NOT NULL,
  "risk_level" "RiskLevel" NOT NULL,
  "reason" TEXT NOT NULL,
  "suggestion" TEXT,
  "evidence" JSONB,
  "status" "AnomalyStatus" NOT NULL DEFAULT 'open',
  "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_anomalies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "risk_rules_rule_key_key" ON "risk_rules"("rule_key");
CREATE INDEX "risk_rules_is_active_idx" ON "risk_rules"("is_active");
CREATE INDEX "risk_rules_target_type_idx" ON "risk_rules"("target_type");
CREATE INDEX "rule_run_results_run_id_idx" ON "rule_run_results"("run_id");
CREATE INDEX "rule_run_results_target_type_target_id_idx" ON "rule_run_results"("target_type", "target_id");
CREATE INDEX "rule_run_results_project_id_idx" ON "rule_run_results"("project_id");
CREATE INDEX "rule_run_results_rule_id_idx" ON "rule_run_results"("rule_id");
CREATE UNIQUE INDEX "ai_anomalies_work_order_id_rule_id_key" ON "ai_anomalies"("work_order_id", "rule_id");
CREATE INDEX "ai_anomalies_status_risk_level_idx" ON "ai_anomalies"("status", "risk_level");
CREATE INDEX "ai_anomalies_project_id_idx" ON "ai_anomalies"("project_id");

ALTER TABLE "rule_run_results" ADD CONSTRAINT "rule_run_results_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "risk_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rule_run_results" ADD CONSTRAINT "rule_run_results_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rule_run_results" ADD CONSTRAINT "rule_run_results_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_anomalies" ADD CONSTRAINT "ai_anomalies_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "risk_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_anomalies" ADD CONSTRAINT "ai_anomalies_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_anomalies" ADD CONSTRAINT "ai_anomalies_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
