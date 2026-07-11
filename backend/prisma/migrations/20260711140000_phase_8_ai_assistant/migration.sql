CREATE TYPE "AiMessageRole" AS ENUM ('user', 'assistant');

CREATE TABLE "ai_conversations" (
  "id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_messages" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "role" "AiMessageRole" NOT NULL,
  "content" TEXT NOT NULL,
  "tool_context" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_model_configs" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model_name" TEXT NOT NULL,
  "display_name" TEXT,
  "base_url" TEXT,
  "api_key_secret_name" TEXT,
  "is_local" BOOLEAN NOT NULL DEFAULT false,
  "supports_tool_call" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_model_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_prompt_versions" (
  "id" TEXT NOT NULL,
  "prompt_key" TEXT NOT NULL,
  "version_no" INTEGER NOT NULL,
  "title" TEXT,
  "system_prompt" TEXT NOT NULL,
  "user_prompt_template" TEXT,
  "output_schema_json" JSONB,
  "is_active" BOOLEAN NOT NULL DEFAULT false,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_prompt_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_call_logs" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT,
  "model_config_id" TEXT,
  "prompt_version_id" TEXT,
  "provider" TEXT NOT NULL,
  "model_name" TEXT NOT NULL,
  "request_payload" JSONB NOT NULL,
  "response_payload" JSONB,
  "input_tokens" INTEGER NOT NULL DEFAULT 0,
  "output_tokens" INTEGER NOT NULL DEFAULT 0,
  "latency_ms" INTEGER NOT NULL DEFAULT 0,
  "success" BOOLEAN NOT NULL DEFAULT true,
  "error_message" TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_call_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_conversations_owner_user_id_updated_at_idx" ON "ai_conversations"("owner_user_id", "updated_at");
CREATE INDEX "ai_messages_conversation_id_created_at_idx" ON "ai_messages"("conversation_id", "created_at");
CREATE INDEX "ai_model_configs_provider_is_active_idx" ON "ai_model_configs"("provider", "is_active");
CREATE UNIQUE INDEX "ai_prompt_versions_prompt_key_version_no_key" ON "ai_prompt_versions"("prompt_key", "version_no");
CREATE INDEX "ai_prompt_versions_prompt_key_is_active_idx" ON "ai_prompt_versions"("prompt_key", "is_active");
CREATE INDEX "ai_call_logs_conversation_id_idx" ON "ai_call_logs"("conversation_id");
CREATE INDEX "ai_call_logs_model_name_created_at_idx" ON "ai_call_logs"("model_name", "created_at");
CREATE INDEX "ai_call_logs_created_at_idx" ON "ai_call_logs"("created_at");

ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_call_logs" ADD CONSTRAINT "ai_call_logs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_call_logs" ADD CONSTRAINT "ai_call_logs_model_config_id_fkey" FOREIGN KEY ("model_config_id") REFERENCES "ai_model_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_call_logs" ADD CONSTRAINT "ai_call_logs_prompt_version_id_fkey" FOREIGN KEY ("prompt_version_id") REFERENCES "ai_prompt_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
