import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFObject,
  PDFRef,
  PDFStream
} from 'pdf-lib';

const ACTIVE_KEYS = new Set([
  'JS',
  'JavaScript',
  'EmbeddedFile',
  'EmbeddedFiles'
]);
const ACTIVE_NAMES = new Set([
  'JavaScript',
  'Launch',
  'EmbeddedFile',
  'RichMedia',
  'GoToR',
  'SubmitForm',
  'ImportData'
]);

export function hasActivePdfContent(document: PDFDocument) {
  const visitedObjects = new Set<PDFObject>();
  const visitedRefs = new Set<string>();
  const context = document.context;

  const inspect = (object: PDFObject | undefined): boolean => {
    if (!object) return false;
    if (object instanceof PDFRef) {
      if (visitedRefs.has(object.tag)) return false;
      visitedRefs.add(object.tag);
      try {
        return inspect(context.lookup(object));
      } catch {
        return true;
      }
    }
    if (visitedObjects.has(object)) return false;
    visitedObjects.add(object);
    if (object instanceof PDFName) return ACTIVE_NAMES.has(object.decodeText());
    if (object instanceof PDFStream) return inspect(object.dict);
    if (object instanceof PDFArray) return object.asArray().some((entry) => inspect(entry));
    if (object instanceof PDFDict) {
      return object.entries().some(([key, value]) => ACTIVE_KEYS.has(key.decodeText()) || inspect(value));
    }
    return false;
  };

  if (inspect(document.catalog)) return true;
  return context.enumerateIndirectObjects().some(([, object]) => inspect(object));
}
