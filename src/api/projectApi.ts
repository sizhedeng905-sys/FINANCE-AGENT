import { mockDataProjects } from '@/mock/mockDataCenter';
import type { Project } from '@/types/dataCenter';
import { delay, ok } from './dataApiUtils';

export async function getProjects() {
  await delay();
  return ok(mockDataProjects);
}

export async function createProject(payload: Partial<Project>) {
  await delay();
  return ok({ ...payload, id: `dp-${Date.now()}` } as Project, '项目已创建');
}

export async function getProject(id: string) {
  await delay();
  return ok(mockDataProjects.find((item) => item.id === id));
}

export async function updateProject(id: string, payload: Partial<Project>) {
  await delay();
  return ok({ id, ...payload } as Project, '项目已更新');
}

export async function deleteProject(id: string) {
  await delay();
  return ok({ id }, '项目已归档');
}
