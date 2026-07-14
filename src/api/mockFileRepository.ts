import { getAccessToken } from './authSession';
import { mockMe } from './mockIdentityRepository';
import { mockGetProject } from './mockProjectRepository';
import { mockAttachFileToWorkOrder, mockDetachFileFromWorkOrder, mockGetWorkOrder } from './mockWorkOrderRepository';
import type { FileBinary, RawFile } from '@/types/file';

const delay = (ms = 120) => new Promise((resolve) => window.setTimeout(resolve, ms));
const maxFileSize = 50 * 1024 * 1024;
const files = new Map<string, RawFile>();
const contents = new Map<string, Blob>();

function extension(name: string): string {
  return name.slice(name.lastIndexOf('.')).toLowerCase();
}

function fileType(name: string): string {
  const value = extension(name);
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(value)) return 'image';
  if (value === '.pdf') return 'pdf';
  if (['.xlsx', '.xls', '.csv'].includes(value)) return 'excel';
  if (['.doc', '.docx'].includes(value)) return 'word';
  return 'other';
}

function clone(file: RawFile): RawFile {
  return { ...file };
}

function legacyFile(id: string): RawFile {
  const now = new Date().toISOString();
  const name = id.includes('.') ? id : `附件-${id}.pdf`;
  const metadata: RawFile = {
    id,
    fileName: name,
    originalFileName: name,
    fileType: fileType(name),
    mimeType: name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream',
    fileSize: 0,
    sha256: 'mock'.padEnd(64, '0'),
    uploadedBy: 'mock-seed',
    uploadedAt: now,
    status: 'uploaded',
    scanStatus: 'clean',
    previewStatus: 'mock',
    isVoided: false,
  };
  files.set(id, metadata);
  contents.set(id, new Blob([`Mock attachment: ${name}`], { type: metadata.mimeType }));
  return metadata;
}

async function accessibleFile(id: string): Promise<RawFile> {
  const user = await mockMe(getAccessToken());
  const file = files.get(id) ?? legacyFile(id);
  if (file.isVoided) throw new Error('资源不存在');
  if (file.relatedWorkOrderId) await mockGetWorkOrder(file.relatedWorkOrderId);
  else if (user.role === 'employee' && file.uploadedBy !== user.id && file.previewStatus !== 'mock') throw new Error('无权限');
  else if (user.role === 'reviewer') throw new Error('无权限');
  return file;
}

async function validateUpload(file: File): Promise<void> {
  const allowed = ['.png', '.jpg', '.jpeg', '.webp', '.pdf', '.xlsx', '.xls', '.csv', '.doc', '.docx'];
  if (!file.size) throw new Error('不能上传空文件');
  if (file.size > maxFileSize) throw new Error('文件大小不能超过 50MB');
  if (!allowed.includes(extension(file.name))) throw new Error('不支持的文件类型');
  if (file.name.includes('/') || file.name.includes('\\') || file.name.length > 255) throw new Error('文件名不合法');
  if (extension(file.name) === '.pdf') {
    const text = new TextDecoder('latin1').decode(await file.arrayBuffer());
    if (!text.startsWith('%PDF-') || !text.includes('%%EOF')) throw new Error('不支持的文件类型');
  }
}

export async function mockUploadFile(file: File, relatedProjectId: string, workOrderId?: string): Promise<RawFile> {
  await delay();
  await validateUpload(file);
  const user = await mockMe(getAccessToken());
  if (user.role === 'employee' && !workOrderId) throw new Error('员工上传附件必须关联本人工单');
  if (user.role === 'finance' && workOrderId) throw new Error('财务只能上传项目级原始文件');
  if (user.role !== 'employee' && user.role !== 'finance') throw new Error('无权限');
  const project = await mockGetProject(relatedProjectId);
  if (project.status !== 'active') throw new Error('项目不存在或未启用');
  if (workOrderId) {
    const workOrder = await mockGetWorkOrder(workOrderId);
    if (workOrder.projectId !== relatedProjectId) throw new Error('文件项目与工单项目不一致');
  }

  const id = `mock-file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (workOrderId) mockAttachFileToWorkOrder(workOrderId, id, user.id);
  const digest = await window.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const metadata: RawFile = {
    id,
    fileName: file.name,
    originalFileName: file.name,
    fileType: fileType(file.name),
    mimeType: file.type || 'application/octet-stream',
    fileSize: file.size,
    sha256,
    uploadedBy: user.id,
    uploadedAt: new Date().toISOString(),
    relatedProjectId,
    relatedWorkOrderId: workOrderId,
    status: 'uploaded',
    scanStatus: 'clean',
    previewStatus: 'original',
    isVoided: false,
  };
  files.set(id, metadata);
  contents.set(id, file);
  return clone(metadata);
}

export async function mockGetFile(id: string): Promise<RawFile> {
  await delay(60);
  return clone(await accessibleFile(id));
}

export async function mockReadFile(id: string): Promise<FileBinary> {
  await delay(80);
  const file = await accessibleFile(id);
  return {
    blob: contents.get(id) ?? new Blob([], { type: file.mimeType }),
    fileName: file.originalFileName,
    mimeType: file.mimeType,
  };
}

export async function mockDeleteFile(id: string, reason?: string): Promise<RawFile> {
  await delay();
  const user = await mockMe(getAccessToken());
  const file = await accessibleFile(id);
  if (user.role === 'boss' || user.role === 'reviewer' || file.uploadedBy !== user.id) throw new Error('无权删除文件');
  if (file.relatedWorkOrderId) mockDetachFileFromWorkOrder(file.relatedWorkOrderId, id, user.id);
  file.status = 'voided';
  file.isVoided = true;
  file.voidReason = reason?.trim() || '用户删除';
  contents.delete(id);
  return clone(file);
}
