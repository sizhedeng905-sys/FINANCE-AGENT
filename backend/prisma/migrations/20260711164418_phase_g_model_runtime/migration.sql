-- CreateEnum
CREATE TYPE "ModelDeploymentStatus" AS ENUM ('unknown', 'healthy', 'unhealthy', 'disabled');

-- CreateEnum
CREATE TYPE "AiTaskStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "AiCallAttemptStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed');

-- AlterTable
ALTER TABLE "ai_call_logs" ADD COLUMN     "attempt_no" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "correlation_id" TEXT,
ADD COLUMN     "endpoint_snapshot" TEXT,
ADD COLUMN     "fallback" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "input_hash" TEXT;

-- CreateTable
CREATE TABLE "model_deployments" (
    "id" TEXT NOT NULL,
    "deployment_key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "model_version" TEXT,
    "endpoint" TEXT,
    "secret_ref" TEXT,
    "task_types" JSONB NOT NULL DEFAULT '[]',
    "max_concurrency" INTEGER NOT NULL DEFAULT 1,
    "timeout_ms" INTEGER NOT NULL DEFAULT 30000,
    "is_local" BOOLEAN NOT NULL DEFAULT true,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" "ModelDeploymentStatus" NOT NULL DEFAULT 'unknown',
    "last_health_at" TIMESTAMP(3),
    "last_health_latency_ms" INTEGER,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_deployments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_model_routes" (
    "id" TEXT NOT NULL,
    "task_type" TEXT NOT NULL,
    "deployment_id" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "fallback_policy" TEXT NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_model_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_tasks" (
    "id" TEXT NOT NULL,
    "task_type" TEXT NOT NULL,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "status" "AiTaskStatus" NOT NULL DEFAULT 'queued',
    "input_hash" TEXT NOT NULL,
    "input_payload" JSONB,
    "output_payload" JSONB,
    "output_ref" TEXT,
    "correlation_id" TEXT NOT NULL,
    "error_message" TEXT,
    "created_by" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_call_attempts" (
    "id" TEXT NOT NULL,
    "ai_task_id" TEXT NOT NULL,
    "deployment_id" TEXT,
    "prompt_version_id" TEXT,
    "attempt_no" INTEGER NOT NULL,
    "status" "AiCallAttemptStatus" NOT NULL DEFAULT 'queued',
    "provider" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "model_version" TEXT,
    "endpoint_snapshot" TEXT,
    "input_hash" TEXT NOT NULL,
    "output_payload" JSONB,
    "output_ref" TEXT,
    "latency_ms" INTEGER,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "unit_count" INTEGER NOT NULL DEFAULT 0,
    "retry" BOOLEAN NOT NULL DEFAULT false,
    "fallback" BOOLEAN NOT NULL DEFAULT false,
    "error_message" TEXT,
    "correlation_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_call_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "model_deployments_deployment_key_key" ON "model_deployments"("deployment_key");

-- CreateIndex
CREATE INDEX "model_deployments_provider_is_enabled_idx" ON "model_deployments"("provider", "is_enabled");

-- CreateIndex
CREATE INDEX "model_deployments_status_idx" ON "model_deployments"("status");

-- CreateIndex
CREATE INDEX "task_model_routes_task_type_is_enabled_priority_idx" ON "task_model_routes"("task_type", "is_enabled", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "task_model_routes_task_type_deployment_id_key" ON "task_model_routes"("task_type", "deployment_id");

-- CreateIndex
CREATE INDEX "ai_tasks_task_type_status_idx" ON "ai_tasks"("task_type", "status");

-- CreateIndex
CREATE INDEX "ai_tasks_resource_type_resource_id_idx" ON "ai_tasks"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "ai_tasks_correlation_id_idx" ON "ai_tasks"("correlation_id");

-- CreateIndex
CREATE INDEX "ai_call_attempts_deployment_id_created_at_idx" ON "ai_call_attempts"("deployment_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_call_attempts_correlation_id_idx" ON "ai_call_attempts"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_call_attempts_ai_task_id_attempt_no_key" ON "ai_call_attempts"("ai_task_id", "attempt_no");

-- CreateIndex
CREATE INDEX "ai_call_logs_correlation_id_idx" ON "ai_call_logs"("correlation_id");

-- AddForeignKey
ALTER TABLE "task_model_routes" ADD CONSTRAINT "task_model_routes_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "model_deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_tasks" ADD CONSTRAINT "ai_tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_call_attempts" ADD CONSTRAINT "ai_call_attempts_ai_task_id_fkey" FOREIGN KEY ("ai_task_id") REFERENCES "ai_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_call_attempts" ADD CONSTRAINT "ai_call_attempts_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "model_deployments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_call_attempts" ADD CONSTRAINT "ai_call_attempts_prompt_version_id_fkey" FOREIGN KEY ("prompt_version_id") REFERENCES "ai_prompt_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
