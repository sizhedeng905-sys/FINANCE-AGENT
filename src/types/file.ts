export interface RawFile {
  id: string;
  fileName: string;
  originalFileName: string;
  fileType: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
  uploadedBy: string;
  uploadedAt: string;
  relatedProjectId?: string;
  relatedWorkOrderId?: string;
  status: 'uploaded' | 'parsed' | 'failed' | 'voided';
  scanStatus: 'pending' | 'clean' | 'infected' | 'failed';
  previewStatus: string;
  isVoided: boolean;
  voidReason?: string;
}

export interface FileBinary {
  blob: Blob;
  fileName: string;
  mimeType: string;
}
