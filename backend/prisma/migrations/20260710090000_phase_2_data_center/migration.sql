CREATE TYPE "ProjectStatus" AS ENUM ('active', 'archived');

CREATE TYPE "DataRecordType" AS ENUM ('cost', 'revenue', 'reimbursement', 'transport', 'labor', 'other');

CREATE TYPE "FieldType" AS ENUM ('text', 'number', 'money', 'date', 'select', 'file', 'textarea');

CREATE TYPE "SemanticType" AS ENUM ('amount', 'date', 'person', 'vehicle', 'project', 'location', 'category', 'remark', 'file');

CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "description" TEXT,
    "owner_name" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'active',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "record_type" "DataRecordType" NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "field_definitions" (
    "id" TEXT NOT NULL,
    "field_key" TEXT NOT NULL,
    "field_name" TEXT NOT NULL,
    "field_type" "FieldType" NOT NULL,
    "unit" TEXT,
    "semantic_type" "SemanticType" NOT NULL,
    "aliases" JSONB,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "field_definitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "template_fields" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "field_id" TEXT NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "default_value" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "template_fields_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "project_templates" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "custom_name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "projects_status_idx" ON "projects"("status");

CREATE INDEX "templates_record_type_idx" ON "templates"("record_type");

CREATE UNIQUE INDEX "field_definitions_field_key_key" ON "field_definitions"("field_key");

CREATE INDEX "field_definitions_is_active_idx" ON "field_definitions"("is_active");

CREATE UNIQUE INDEX "template_fields_template_id_field_id_key" ON "template_fields"("template_id", "field_id");

CREATE INDEX "template_fields_field_id_idx" ON "template_fields"("field_id");

CREATE UNIQUE INDEX "project_templates_project_id_template_id_key" ON "project_templates"("project_id", "template_id");

CREATE INDEX "project_templates_template_id_idx" ON "project_templates"("template_id");

ALTER TABLE "template_fields" ADD CONSTRAINT "template_fields_template_id_fkey"
FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "template_fields" ADD CONSTRAINT "template_fields_field_id_fkey"
FOREIGN KEY ("field_id") REFERENCES "field_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_template_id_fkey"
FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
