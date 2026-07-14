import {
  mockDataProjects,
  mockImportTasks,
  mockProjectTemplates,
  mockRawFiles,
  mockTemplateFields,
  mockDataTemplates,
} from '@/mock/mockDataCenter';
import type {
  CreateProjectPayload,
  CreateProjectTemplatePayload,
  PaginatedProjects,
  Project,
  ProjectListQuery,
  ProjectSummary,
  ProjectTemplate,
  UpdateProjectPayload,
  UpdateProjectTemplatePayload,
} from '@/types/dataCenter';
import { mockRecordSnapshot } from './mockRecordRepository';

const delay = (ms = 160) => new Promise((resolve) => window.setTimeout(resolve, ms));
let projects = mockDataProjects.map((project) => ({ ...project }));
let projectTemplates = mockProjectTemplates.map((item) => ({ ...item }));

function clone(project: Project): Project {
  return { ...project };
}

function findOrThrow(id: string): Project {
  const project = projects.find((item) => item.id === id);
  if (!project) throw new Error('资源不存在');
  return project;
}

function cloneProjectTemplate(item: ProjectTemplate): ProjectTemplate {
  return { ...item };
}

function projectTemplateOrThrow(id: string): ProjectTemplate {
  const item = projectTemplates.find((candidate) => candidate.id === id);
  if (!item) throw new Error('资源不存在');
  return item;
}

function assertProjectWritable(projectId: string): Project {
  const project = findOrThrow(projectId);
  if (project.status !== 'active') throw new Error('归档项目不能修改启用模板');
  return project;
}

export function mockProjectTemplateSnapshot(): ProjectTemplate[] {
  return projectTemplates.map(cloneProjectTemplate);
}

export async function mockGetProjects(query: ProjectListQuery = {}): Promise<PaginatedProjects> {
  await delay();
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const keyword = query.keyword?.trim().toLowerCase();
  const filtered = projects.filter((project) => {
    if (query.status && project.status !== query.status) return false;
    if (!keyword) return true;
    return [project.name, project.customerName, project.ownerName].some((value) =>
      value.toLowerCase().includes(keyword),
    );
  });
  const start = (page - 1) * pageSize;
  return {
    items: filtered.slice(start, start + pageSize).map(clone),
    page,
    pageSize,
    total: filtered.length,
  };
}

export async function mockGetProject(id: string): Promise<Project> {
  await delay();
  return clone(findOrThrow(id));
}

export async function mockCreateProject(payload: CreateProjectPayload): Promise<Project> {
  await delay();
  const now = new Date().toISOString();
  const project: Project = {
    id: `mock-project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: payload.name.trim(),
    customerName: payload.customerName.trim(),
    ownerName: payload.ownerName.trim(),
    description: payload.description?.trim() ?? '',
    status: payload.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  };
  projects = [project, ...projects];
  return clone(project);
}

export async function mockUpdateProject(id: string, payload: UpdateProjectPayload): Promise<Project> {
  await delay();
  const project = findOrThrow(id);
  Object.assign(project, payload, { updatedAt: new Date().toISOString() });
  return clone(project);
}

export async function mockArchiveProject(id: string): Promise<{ id: string; status: Project['status'] }> {
  await delay();
  const project = findOrThrow(id);
  project.status = 'archived';
  project.updatedAt = new Date().toISOString();
  return { id, status: project.status };
}

export async function mockGetProjectSummary(id: string): Promise<ProjectSummary> {
  await delay();
  const project = clone(findOrThrow(id));
  const enabledTemplateIds = projectTemplates
    .filter((item) => item.projectId === id && item.isActive)
    .map((item) => item.templateId);
  const records = mockRecordSnapshot().filter((item) => item.projectId === id);
  const confirmedRecords = records.filter((item) => item.status === 'confirmed');
  const income = confirmedRecords
    .filter((item) => item.recordType === 'revenue' || item.category === '收入')
    .reduce((sum, item) => sum + item.amount, 0);
  const cost = confirmedRecords
    .filter((item) => item.recordType !== 'revenue' && item.category !== '收入')
    .reduce((sum, item) => sum + item.amount, 0);
  return {
    project,
    enabledTemplateCount: enabledTemplateIds.length,
    fieldCount: new Set(
      mockTemplateFields.filter((item) => enabledTemplateIds.includes(item.templateId)).map((item) => item.fieldId),
    ).size,
    recordCount: records.length,
    rawFileCount: mockRawFiles.filter((item) => item.relatedProjectId === id).length,
    importTaskCount: mockImportTasks.filter((item) => item.projectId === id).length,
    totalIncome: income,
    totalCost: cost,
    profit: income - cost,
  };
}

export async function mockGetProjectTemplates(projectId: string): Promise<ProjectTemplate[]> {
  await delay();
  findOrThrow(projectId);
  return projectTemplates
    .filter((item) => item.projectId === projectId)
    .sort((first, second) => String(second.createdAt).localeCompare(String(first.createdAt)))
    .map(cloneProjectTemplate);
}

export async function mockEnableProjectTemplate(
  projectId: string,
  payload: CreateProjectTemplatePayload,
): Promise<ProjectTemplate> {
  await delay();
  assertProjectWritable(projectId);
  const existing = projectTemplates.find(
    (item) => item.projectId === projectId && item.templateId === payload.templateId,
  );
  if (existing?.isActive) throw new Error('该模板已在项目中启用');
  const now = new Date().toISOString();
  const defaultName = mockDataTemplates.find((template) => template.id === payload.templateId)?.name ?? payload.templateId;
  if (existing) {
    existing.isActive = true;
    existing.customName = payload.customName?.trim() || existing.customName || defaultName;
    existing.updatedAt = now;
    return cloneProjectTemplate(existing);
  }
  const item: ProjectTemplate = {
    id: `mock-project-template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    projectId,
    templateId: payload.templateId,
    customName: payload.customName?.trim() || defaultName,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  projectTemplates = [item, ...projectTemplates];
  return cloneProjectTemplate(item);
}

export async function mockUpdateProjectTemplate(
  id: string,
  payload: UpdateProjectTemplatePayload,
): Promise<ProjectTemplate> {
  await delay();
  const item = projectTemplateOrThrow(id);
  assertProjectWritable(item.projectId);
  const customName = payload.customName.trim();
  if (!customName) throw new Error('项目模板名称不能为空');
  item.customName = customName;
  item.updatedAt = new Date().toISOString();
  return cloneProjectTemplate(item);
}

export async function mockDisableProjectTemplate(id: string): Promise<ProjectTemplate> {
  await delay();
  const item = projectTemplateOrThrow(id);
  assertProjectWritable(item.projectId);
  if (!item.isActive) return cloneProjectTemplate(item);
  item.isActive = false;
  item.updatedAt = new Date().toISOString();
  return cloneProjectTemplate(item);
}
