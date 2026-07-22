import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Empty, Select, Space, Spin, Tag, Typography } from 'antd';
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type RenderTask,
} from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import { previewFile } from '@/api/fileApi';
import type { OCRFieldCandidate } from '@/types/dataCenter';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface OcrEvidencePreviewProps {
  rawFileId: string;
  fileName: string;
  mimeType: string;
  pages: Array<Record<string, unknown>>;
  textBlocks: Array<Record<string, unknown>>;
  field?: OCRFieldCandidate;
}

interface EvidenceBox {
  ref: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PageGeometry {
  page: number;
  width?: number;
  height?: number;
  sourceRotation: number;
  rotationApplied: number;
}

export default function OcrEvidencePreview({
  rawFileId,
  fileName,
  mimeType,
  pages,
  textBlocks,
  field,
}: OcrEvidencePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask>();
  const [objectUrl, setObjectUrl] = useState<string>();
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [loadedMimeType, setLoadedMimeType] = useState(mimeType);
  const [selectedPage, setSelectedPage] = useState<number>();
  const [renderGeometry, setRenderGeometry] = useState<{ width: number; height: number }>();
  const [renderReady, setRenderReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const pageGeometries = useMemo(() => normalizePages(pages), [pages]);
  const evidenceRefs = useMemo(() => new Set(field?.evidenceRefs ?? []), [field?.evidenceRefs]);
  const evidenceBoxes = useMemo(
    () => resolveEvidenceBoxes(field, evidenceRefs, textBlocks),
    [evidenceRefs, field, textBlocks],
  );

  useEffect(() => {
    setSelectedPage(field?.page ?? pageGeometries[0]?.page);
  }, [field?.fieldId, field?.page, pageGeometries]);

  useEffect(() => {
    let active = true;
    let nextUrl: string | undefined;
    setLoading(true);
    setError(undefined);
    setPdf(undefined);
    setObjectUrl(undefined);
    setRenderGeometry(undefined);
    setRenderReady(false);
    void loadingTaskRef.current?.destroy();
    loadingTaskRef.current = undefined;
    void previewFile(rawFileId)
      .then(async (result) => {
        if (!active) return;
        const effectiveMimeType = result.mimeType === 'application/octet-stream' ? mimeType : result.mimeType;
        setLoadedMimeType(effectiveMimeType);
        nextUrl = URL.createObjectURL(result.blob);
        setObjectUrl(nextUrl);
        if (effectiveMimeType === 'application/pdf') {
          const loadingTask = getDocument({ data: await result.blob.arrayBuffer() });
          loadingTaskRef.current = loadingTask;
          const document = await loadingTask.promise;
          if (!active) {
            await loadingTask.destroy();
            return;
          }
          setPdf(document);
        }
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : '证据文件加载失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      if (nextUrl) URL.revokeObjectURL(nextUrl);
      void loadingTaskRef.current?.destroy();
      loadingTaskRef.current = undefined;
    };
  }, [mimeType, rawFileId]);

  useEffect(() => {
    if (!pdf || selectedPage === undefined || !canvasRef.current) return undefined;
    let active = true;
    let renderTask: RenderTask | undefined;
    setRenderReady(false);
    const pageIndex = selectedPage >= 1 && selectedPage <= pdf.numPages
      ? selectedPage
      : Math.max(1, pageGeometries.findIndex((page) => page.page === selectedPage) + 1);
    void pdf.getPage(Math.min(pageIndex, pdf.numPages)).then((page) => {
      if (!active || !canvasRef.current) return;
      const baseViewport = page.getViewport({ scale: 1 });
      const cssWidth = Math.min(900, Math.max(320, baseViewport.width));
      const cssScale = cssWidth / baseViewport.width;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: cssScale * pixelRatio });
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('浏览器无法创建 PDF 画布');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      setRenderGeometry({ width: cssWidth, height: baseViewport.height * cssScale });
      renderTask = page.render({ canvasContext: context, viewport, canvas });
      return renderTask.promise.then(() => {
        if (active) setRenderReady(true);
      });
    }).catch((reason) => {
      if (active && reason?.name !== 'RenderingCancelledException') {
        setError(reason instanceof Error ? reason.message : 'PDF 页面渲染失败');
      }
    });
    return () => {
      active = false;
      renderTask?.cancel();
    };
  }, [pageGeometries, pdf, selectedPage]);

  const selectedGeometry = pageGeometries.find((page) => page.page === selectedPage);
  const sourceWidth = selectedGeometry?.width ?? renderGeometry?.width;
  const sourceHeight = selectedGeometry?.height ?? renderGeometry?.height;
  const activeBoxes = evidenceBoxes.filter((box) => box.page === selectedPage);
  const coordinateTransformKnown = !selectedGeometry
    || (selectedGeometry.sourceRotation === 0 && selectedGeometry.rotationApplied === 0);
  const overlayWidth = coordinateTransformKnown && renderReady ? sourceWidth : undefined;
  const overlayHeight = coordinateTransformKnown && renderReady ? sourceHeight : undefined;
  const isPdf = loadedMimeType === 'application/pdf';
  const isImage = loadedMimeType.startsWith('image/');

  if (error) return <Alert type="error" showIcon message="证据文件加载失败" description={error} />;
  if (!field) return <Empty description="请选择字段查看原始证据" />;

  return (
    <Spin spinning={loading}>
      <Space direction="vertical" size="middle" className="full-width">
        <div className="ocr-evidence-toolbar">
          <div>
            <Typography.Text strong>{field.fieldName}</Typography.Text>
            <Typography.Text type="secondary"> · {fileName}</Typography.Text>
          </div>
          <Select
            aria-label="证据页码"
            value={selectedPage}
            options={pageGeometries.map((page) => ({ value: page.page, label: `第 ${page.page} 页` }))}
            onChange={setSelectedPage}
            className="ocr-page-select"
          />
        </div>
        <Space wrap>
          {field.evidenceRefs.map((ref) => <Tag key={ref}>{ref}</Tag>)}
          {field.valueSource === 'MANUAL_OVERRIDE' ? <Tag color="processing">人工修订</Tag> : null}
          {field.evidenceConflict ? <Tag color="error">证据冲突</Tag> : null}
        </Space>
        {!sourceWidth || !sourceHeight ? (
          <Alert type="warning" showIcon message="该页缺少坐标尺寸，暂时不能可靠叠加 bbox" />
        ) : null}
        {!coordinateTransformKnown ? (
          <Alert type="warning" showIcon message="该页包含尚未在预览端复现的旋转变换，仅展示证据引用" />
        ) : null}
        <div
          className="ocr-evidence-stage"
          style={renderGeometry ? { maxWidth: renderGeometry.width, aspectRatio: `${renderGeometry.width} / ${renderGeometry.height}` } : undefined}
        >
          {isPdf ? <canvas ref={canvasRef} className="ocr-evidence-document" /> : null}
          {isImage && objectUrl ? (
            <img
              className="ocr-evidence-document"
              src={objectUrl}
              alt={fileName}
              onLoad={(event) => {
                setRenderGeometry({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                });
                setRenderReady(true);
              }}
            />
          ) : null}
          {overlayWidth && overlayHeight ? activeBoxes.map((box) => (
            <div
              key={`${box.ref}:${box.page}`}
              className="ocr-evidence-box"
              title={box.ref}
              style={{
                left: `${(box.x / overlayWidth) * 100}%`,
                top: `${(box.y / overlayHeight) * 100}%`,
                width: `${(box.width / overlayWidth) * 100}%`,
                height: `${(box.height / overlayHeight) * 100}%`,
              }}
            >
              <span>{box.ref}</span>
            </div>
          )) : null}
        </div>
        {!activeBoxes.length || !overlayWidth || !overlayHeight ? <Alert type="warning" showIcon message="当前页没有可可靠绘制的 bbox，仍保留 evidence ref 供人工核对" /> : null}
      </Space>
    </Spin>
  );
}

function normalizePages(pages: Array<Record<string, unknown>>): PageGeometry[] {
  return pages.flatMap((page) => {
    const pageNumber = typeof page.page === 'number' && Number.isInteger(page.page) ? page.page : undefined;
    if (pageNumber === undefined) return [];
    return [{
      page: pageNumber,
      width: finitePositive(page.width),
      height: finitePositive(page.height),
      sourceRotation: finiteNumber(page.sourceRotation) ?? finiteNumber(page.rotation) ?? 0,
      rotationApplied: finiteNumber(page.rotationApplied)
        ?? (isRecord(page.preprocessing) ? finiteNumber(page.preprocessing.rotationApplied) : undefined)
        ?? 0,
    }];
  });
}

function resolveEvidenceBoxes(
  field: OCRFieldCandidate | undefined,
  evidenceRefs: ReadonlySet<string>,
  textBlocks: Array<Record<string, unknown>>,
): EvidenceBox[] {
  if (!field) return [];
  const boxes: EvidenceBox[] = [];
  for (const rawBlock of textBlocks) {
    const page = finitePositive(rawBlock.page);
    if (!page) continue;
    const blockId = typeof rawBlock.blockId === 'string' ? rawBlock.blockId : undefined;
    if (blockId && evidenceRefs.has(blockId)) {
      const box = tupleBox(rawBlock.bbox);
      if (box) boxes.push({ ref: blockId, page, ...box });
    }
    if (!Array.isArray(rawBlock.tokens)) continue;
    for (const rawToken of rawBlock.tokens) {
      if (!rawToken || typeof rawToken !== 'object' || Array.isArray(rawToken)) continue;
      const token = rawToken as Record<string, unknown>;
      const tokenId = typeof token.tokenId === 'string' ? token.tokenId : undefined;
      if (!tokenId || !evidenceRefs.has(tokenId)) continue;
      const box = tupleBox(token.bbox);
      if (box) boxes.push({ ref: tokenId, page, ...box });
    }
  }
  for (const alternative of field.alternatives) {
    if (!alternative.boundingBox || !alternative.evidenceRefs.some((ref) => evidenceRefs.has(ref))) continue;
    const ref = alternative.evidenceRefs.find((item) => evidenceRefs.has(item))!;
    boxes.push({ ref, page: alternative.page, ...alternative.boundingBox });
  }
  if (!boxes.length && field.boundingBox) {
    boxes.push({ ref: field.evidenceRefs[0] ?? `candidate:${field.fieldId}`, page: field.page, ...field.boundingBox });
  }
  return [...new Map(boxes.map((box) => [`${box.ref}:${box.page}`, box])).values()];
}

function tupleBox(value: unknown) {
  if (!Array.isArray(value) || value.length !== 4 || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    return undefined;
  }
  const [left, top, right, bottom] = value as number[];
  if (left < 0 || top < 0 || right <= left || bottom <= top) return undefined;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function finitePositive(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
