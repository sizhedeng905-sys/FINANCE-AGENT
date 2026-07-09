import { mockRawFiles } from '@/mock/mockDataCenter';
import type { RawFile } from '@/types/dataCenter';
import { delay, ok } from './dataApiUtils';

export async function uploadFile(file: File | string, relatedProjectId: string) {
  await delay();
  const fileName = typeof file === 'string' ? file : file.name;
  return ok({
    id: `rf-${Date.now()}`,
    fileName,
    fileType: fileName.endsWith('.xlsx') ? 'excel' : 'other',
    storagePath: `/mock/${fileName}`,
    uploadedBy: '当前用户',
    uploadedAt: new Date().toISOString(),
    relatedProjectId,
    status: 'uploaded',
  } as RawFile);
}

export async function getFile(id: string) {
  await delay();
  return ok(mockRawFiles.find((item) => item.id === id));
}
