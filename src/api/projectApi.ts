import { runtimeConfig } from '@/config/runtime';
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
import { httpClient } from './httpClient';
import {
  mockArchiveProject,
  mockCreateProject,
  mockGetProject,
  mockGetProjectSummary,
  mockGetProjectTemplates,
  mockGetProjects,
  mockDisableProjectTemplate,
  mockEnableProjectTemplate,
  mockUpdateProject,
  mockUpdateProjectTemplate,
} from './mockProjectRepository';

function queryString(query: ProjectListQuery): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  const value = params.toString();
  return value ? `?${value}` : '';
}

export function getProjects(query: ProjectListQuery = {}): Promise<PaginatedProjects> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.get<PaginatedProjects>(`/projects${queryString(query)}`)
    : mockGetProjects(query);
}

export function createProject(payload: CreateProjectPayload): Promise<Project> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<Project>('/projects', payload)
    : mockCreateProject(payload);
}

export function getProject(id: string): Promise<Project> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.get<Project>(`/projects/${encodeURIComponent(id)}`)
    : mockGetProject(id);
}

export function updateProject(id: string, payload: UpdateProjectPayload): Promise<Project> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.patch<Project>(`/projects/${encodeURIComponent(id)}`, payload)
    : mockUpdateProject(id, payload);
}

export function deleteProject(id: string): Promise<{ id: string; status: Project['status'] }> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.delete<{ id: string; status: Project['status'] }>(`/projects/${encodeURIComponent(id)}`)
    : mockArchiveProject(id);
}

export function getProjectSummary(id: string): Promise<ProjectSummary> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.get<ProjectSummary>(`/projects/${encodeURIComponent(id)}/summary`)
    : mockGetProjectSummary(id);
}

export function getProjectTemplates(projectId: string): Promise<ProjectTemplate[]> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.get<ProjectTemplate[]>(`/projects/${encodeURIComponent(projectId)}/templates`)
    : mockGetProjectTemplates(projectId);
}

export function enableProjectTemplate(
  projectId: string,
  payload: CreateProjectTemplatePayload,
): Promise<ProjectTemplate> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<ProjectTemplate>(`/projects/${encodeURIComponent(projectId)}/templates`, payload)
    : mockEnableProjectTemplate(projectId, payload);
}

export function updateProjectTemplate(
  id: string,
  payload: UpdateProjectTemplatePayload,
): Promise<ProjectTemplate> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.patch<ProjectTemplate>(`/project-templates/${encodeURIComponent(id)}`, payload)
    : mockUpdateProjectTemplate(id, payload);
}

export function disableProjectTemplate(id: string): Promise<ProjectTemplate> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.patch<ProjectTemplate>(`/project-templates/${encodeURIComponent(id)}/disable`)
    : mockDisableProjectTemplate(id);
}
