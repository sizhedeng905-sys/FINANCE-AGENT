import { useEffect, useMemo, useState } from 'react';
import {
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  FileImageOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { Alert, App, Button, Empty, Modal, Popconfirm, Space, Spin, Tag, Tooltip, Typography } from 'antd';
import { deleteFile, downloadFile, getFile, previewFile } from '@/api/fileApi';
import type { RawFile } from '@/types/file';

interface AttachmentPreviewProps {
  attachments: string[];
  canDelete?: boolean;
  onDeleted?: (id: string) => void | Promise<void>;
}

function fileSize(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function AttachmentPreview({ attachments, canDelete = false, onDeleted }: AttachmentPreviewProps) {
  const { message } = App.useApp();
  const [files, setFiles] = useState<RawFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string>();
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<{ url: string; name: string; mimeType: string }>();
  const attachmentKey = useMemo(() => attachments.join('|'), [attachments]);

  useEffect(() => {
    let active = true;
    if (!attachments.length) {
      setFiles([]);
      setError(undefined);
      return () => { active = false; };
    }
    setLoading(true);
    setFiles([]);
    setError(undefined);
    void Promise.allSettled(attachments.map((id) => getFile(id)))
      .then((results) => {
        if (!active) return;
        const available = results
          .filter((result): result is PromiseFulfilledResult<RawFile> => result.status === 'fulfilled')
          .map((result) => result.value);
        setFiles(available);
        if (available.length !== results.length) setError('部分附件不存在、已删除或当前账号无权访问');
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : '附件加载失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [attachmentKey]);

  const closePreview = () => {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(undefined);
  };

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview.url);
  }, [preview]);

  const openPreview = async (file: RawFile) => {
    setActionId(file.id);
    try {
      const result = await previewFile(file.id);
      if (!result.mimeType.startsWith('image/') && result.mimeType !== 'application/pdf') {
        saveBlob(result.blob, result.fileName);
        message.info('该文件类型已转为下载');
        return;
      }
      closePreview();
      setPreview({
        url: URL.createObjectURL(result.blob),
        name: result.fileName,
        mimeType: result.mimeType,
      });
    } catch (reason) {
      message.error(reason instanceof Error ? reason.message : '附件预览失败');
    } finally {
      setActionId(undefined);
    }
  };

  const download = async (file: RawFile) => {
    setActionId(file.id);
    try {
      const result = await downloadFile(file.id);
      saveBlob(result.blob, result.fileName);
    } catch (reason) {
      message.error(reason instanceof Error ? reason.message : '附件下载失败');
    } finally {
      setActionId(undefined);
    }
  };

  const remove = async (file: RawFile) => {
    setActionId(file.id);
    try {
      await deleteFile(file.id, '从可编辑工单移除附件');
      setFiles((items) => items.filter((item) => item.id !== file.id));
      await onDeleted?.(file.id);
      message.success('附件已删除');
    } catch (reason) {
      message.error(reason instanceof Error ? reason.message : '附件删除失败');
    } finally {
      setActionId(undefined);
    }
  };

  if (!attachments.length) return <Empty description="暂无附件" />;

  return (
    <Spin spinning={loading}>
      {error ? <Alert type="error" showIcon message="附件加载失败" description={error} /> : null}
      <Space direction="vertical" className="full-width">
        {files.map((file) => (
          <div className="attachment-row" key={file.id}>
            {file.fileType === 'image' ? <FileImageOutlined /> : <FileTextOutlined />}
            <div className="attachment-name">
              <Typography.Text ellipsis={{ tooltip: file.originalFileName }}>{file.originalFileName}</Typography.Text>
              <Typography.Text type="secondary">{fileSize(file.fileSize)}</Typography.Text>
            </div>
            <Tag color={file.scanStatus === 'clean' ? 'green' : file.scanStatus === 'pending' ? 'gold' : 'red'}>
              {file.scanStatus === 'clean' ? '已检查' : file.scanStatus === 'pending' ? '待扫描' : '扫描异常'}
            </Tag>
            <Space size={2} className="attachment-actions">
              <Tooltip title="预览">
                <Button
                  type="text"
                  shape="circle"
                  icon={<EyeOutlined />}
                  loading={actionId === file.id}
                  onClick={() => void openPreview(file)}
                />
              </Tooltip>
              <Tooltip title="下载">
                <Button
                  type="text"
                  shape="circle"
                  icon={<DownloadOutlined />}
                  loading={actionId === file.id}
                  onClick={() => void download(file)}
                />
              </Tooltip>
              {canDelete ? (
                <Popconfirm title="删除该附件？" description="原始文件将软删除并保留审计记录。" onConfirm={() => remove(file)}>
                  <Tooltip title="删除">
                    <Button type="text" danger shape="circle" icon={<DeleteOutlined />} loading={actionId === file.id} />
                  </Tooltip>
                </Popconfirm>
              ) : null}
            </Space>
          </div>
        ))}
      </Space>
      <Modal title={preview?.name} open={Boolean(preview)} footer={null} width={900} onCancel={closePreview} destroyOnClose>
        {preview?.mimeType.startsWith('image/') ? (
          <img className="attachment-preview-image" src={preview.url} alt={preview.name} />
        ) : preview ? (
          <iframe className="attachment-preview-frame" src={preview.url} title={preview.name} />
        ) : null}
      </Modal>
    </Spin>
  );
}
