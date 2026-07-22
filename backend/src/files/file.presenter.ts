import { RawFile } from '@prisma/client';

export function toRawFile(file: RawFile) {
  return {
    id: file.id,
    fileName: file.fileName,
    originalFileName: file.originalFileName,
    fileType: file.fileType,
    mimeType: file.mimeType,
    fileSize: Number(file.fileSize),
    sha256: file.sha256,
    uploadedBy: file.uploadedBy,
    uploadedAt: file.uploadedAt.toISOString(),
    relatedProjectId: file.relatedProjectId ?? undefined,
    relatedWorkOrderId: file.relatedWorkOrderId ?? undefined,
    status: file.status,
    scanStatus: file.scanStatus,
    previewStatus: file.previewStatus,
    trustStatus: 'untrusted_original',
    safePreviewAvailable: file.fileType === 'image' && file.scanStatus === 'clean',
    downloadPolicy: 'untrusted_original_attachment',
    isVoided: file.isVoided,
    voidReason: file.voidReason ?? undefined
  };
}
