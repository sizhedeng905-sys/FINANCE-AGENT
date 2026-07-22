import * as yauzl from 'yauzl';

const MAX_ARCHIVE_ENTRIES = 2_000;
const MAX_ARCHIVE_EXPANDED_BYTES = 100 * 1024 * 1024;
const MAX_ARCHIVE_RATIO = 100;
const MAX_XML_ENTRY_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_INSPECTED_XML_BYTES = 50 * 1024 * 1024;
const SAFE_PART_ROOTS = ['_rels/', 'docProps/', 'xl/', 'word/', 'customXml/'];
const SAFE_BINARY_PART = /\.(?:png|jpe?g|gif|bmp|tiff?)$/i;
const ACTIVE_PART = /(?:^|\/)(?:vbaProject|macrosheets?|dialogsheet|embeddings?|externalLinks?|activeX|ctrlProps|printerSettings)(?:\/|\.|$)|oleObject/i;
const ACTIVE_CONTENT_TYPE = /macroEnabled|vnd\.ms-office\.vbaProject|oleObject|activeX|x-macrosheet|x-intlmacrosheet|encryptedPackage/i;
const ACTIVE_RELATIONSHIP = /(?:oleObject|package|externalLink|attachedTemplate|vbaProject|activeX|control|hyperlink)$/i;
const ACTIVE_FORMULA_FUNCTION = /(?:WEBSERVICE|HYPERLINK|DDE|CALL|EXEC|REGISTER(?:\.ID)?|RTD)\s*\(/i;
const DDE_FORMULA = /\|(?:&apos;|&#39;|['"])[\s\S]*?!/i;
const ACTIVE_FIELD = /<(?:\w+:)?(?:instrText|fldSimple)\b[\s\S]*?(?:DDEAUTO?|INCLUDETEXT|INCLUDEPICTURE|HYPERLINK)\b/i;

export class OoxmlSecurityError extends Error {}

export function validateOoxmlPackage(buffer: Buffer, extension: '.xlsx' | '.docx') {
  return new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (openError, zip) => {
      if (openError || !zip) {
        reject(new OoxmlSecurityError('Office file is not a valid OOXML archive'));
        return;
      }

      let settled = false;
      let entries = 0;
      let totalCompressed = 0;
      let totalExpanded = 0;
      let totalInspectedXml = 0;
      let hasContentTypes = false;
      let hasMainDocument = false;
      const partNames = new Set<string>();
      const activeDefaultExtensions = new Set<string>();

      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        zip.close();
        if (error) reject(error instanceof Error ? error : new OoxmlSecurityError('Office package inspection failed'));
        else resolve();
      };

      zip.on('error', () => finish(new OoxmlSecurityError('Office archive read failed')));
      zip.on('end', () => {
        if (!hasContentTypes || !hasMainDocument) {
          finish(new OoxmlSecurityError('Office file is missing required OOXML parts'));
          return;
        }
        const hasActiveDefaultPart = [...partNames].some((part) => {
          const extension = part.includes('.') ? part.slice(part.lastIndexOf('.') + 1).toLowerCase() : '';
          return activeDefaultExtensions.has(extension);
        });
        if (hasActiveDefaultPart) {
          finish(new OoxmlSecurityError('Office content types declare active content'));
          return;
        }
        finish();
      });
      zip.on('entry', (entry: yauzl.Entry) => {
        if (settled) return;
        try {
          entries += 1;
          totalCompressed += entry.compressedSize;
          totalExpanded += entry.uncompressedSize;
          assertPolicy(entries <= MAX_ARCHIVE_ENTRIES, 'Office archive entry limit exceeded');
          assertPolicy(totalExpanded <= MAX_ARCHIVE_EXPANDED_BYTES, 'Office expanded size limit exceeded');
          assertPolicy(totalExpanded / Math.max(1, totalCompressed) <= MAX_ARCHIVE_RATIO, 'Office archive ratio is unsafe');
          assertPolicy(
            entry.uncompressedSize / Math.max(1, entry.compressedSize) <= MAX_ARCHIVE_RATIO,
            'Office archive entry ratio is unsafe'
          );
          assertPolicy((entry.generalPurposeBitFlag & 0x1) === 0, 'Encrypted Office archives are not supported');

          const part = validatePartName(entry.fileName);
          const duplicateKey = part.toLowerCase();
          assertPolicy(!partNames.has(duplicateKey), 'Office archive contains duplicate part names');
          partNames.add(duplicateKey);
          assertPolicy(isAllowedPart(part), 'Office archive contains an atypical or unsafe part path');
          assertPolicy(!ACTIVE_PART.test(part), 'Office file contains macros, embedded objects, or external-link parts');

          if (part === '[Content_Types].xml') hasContentTypes = true;
          if (extension === '.xlsx' && part === 'xl/workbook.xml') hasMainDocument = true;
          if (extension === '.docx' && part === 'word/document.xml') hasMainDocument = true;
          if (part.endsWith('/') || (!part.endsWith('.xml') && !part.endsWith('.rels'))) {
            zip.readEntry();
            return;
          }

          assertPolicy(entry.uncompressedSize <= MAX_XML_ENTRY_BYTES, 'Office XML part exceeds inspection limit');
          totalInspectedXml += entry.uncompressedSize;
          assertPolicy(totalInspectedXml <= MAX_TOTAL_INSPECTED_XML_BYTES, 'Office XML inspection budget exceeded');
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) {
              finish(new OoxmlSecurityError('Office XML part cannot be read'));
              return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            stream.on('data', (chunk: Buffer) => {
              size += chunk.length;
              if (size > MAX_XML_ENTRY_BYTES) stream.destroy(new Error('Office XML part is too large'));
              else chunks.push(chunk);
            });
            stream.on('error', () => finish(new OoxmlSecurityError('Office XML part read failed')));
            stream.on('end', () => {
              if (settled) return;
              try {
                for (const activeExtension of inspectXml(part, Buffer.concat(chunks).toString('utf8'), extension)) {
                  activeDefaultExtensions.add(activeExtension);
                }
                zip.readEntry();
              } catch (error) {
                finish(error);
              }
            });
          });
        } catch (error) {
          finish(error);
        }
      });
      zip.readEntry();
    });
  });
}

function validatePartName(value: string) {
  const normalized = value.normalize('NFC');
  const segmentsPath = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  assertPolicy(normalized === value, 'Office part name is not canonically encoded');
  assertPolicy(
    normalized.length > 0 &&
      !normalized.startsWith('/') &&
      !normalized.includes('\\') &&
      !normalized.includes(':') &&
      !/%(?:2e|2f|5c)/i.test(normalized) &&
      !/[\u0000-\u001f\u007f]/.test(normalized) &&
      !segmentsPath.split('/').some((segment) => segment === '.' || segment === '..' || segment === ''),
    'Office archive contains an invalid part path'
  );
  return normalized;
}

function isAllowedPart(part: string) {
  if (part === '[Content_Types].xml') return true;
  if (!SAFE_PART_ROOTS.some((root) => part.startsWith(root))) return false;
  if (part.endsWith('/')) return true;
  return part.endsWith('.xml') || part.endsWith('.rels') || SAFE_BINARY_PART.test(part);
}

function inspectXml(part: string, xml: string, extension: '.xlsx' | '.docx') {
  const activeDefaultExtensions: string[] = [];
  assertPolicy(!/<!DOCTYPE|<!ENTITY/i.test(xml), 'Office XML entity declarations are not allowed');
  if (part === '[Content_Types].xml') {
    assertPolicy(/<(?:\w+:)?Types\b/i.test(xml), 'Office content types are malformed');
    for (const tag of xml.match(/<(?:\w+:)?(?:Default|Override)\b[^>]*>/gi) ?? []) {
      const contentType = readXmlAttribute(tag, 'ContentType');
      if (!contentType || !ACTIVE_CONTENT_TYPE.test(contentType)) continue;
      if (/<(?:\w+:)?Override\b/i.test(tag)) {
        throw new OoxmlSecurityError('Office content types declare active content');
      }
      const declaredExtension = readXmlAttribute(tag, 'Extension')?.toLowerCase();
      assertPolicy(Boolean(declaredExtension), 'Office content types are malformed');
      activeDefaultExtensions.push(declaredExtension!);
    }
    const required = extension === '.xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
    assertPolicy(xml.includes(required), 'Office content types do not match the file extension');
  }
  if (part.endsWith('.rels')) {
    assertPolicy(!/TargetMode\s*=\s*["']External["']/i.test(xml), 'Office file contains an external relationship');
    const relationshipTypes = [...xml.matchAll(/Type\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]);
    assertPolicy(!relationshipTypes.some((type) => ACTIVE_RELATIONSHIP.test(type)), 'Office relationship type is active');
  }
  if (extension === '.xlsx' && part.startsWith('xl/')) {
    const formulas = [...xml.matchAll(/<(?:\w+:)?f(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?f>/gi)].map((match) => match[1]);
    assertPolicy(
      !formulas.some((formula) => ACTIVE_FORMULA_FUNCTION.test(formula) || DDE_FORMULA.test(formula)),
      'Office file contains an active formula'
    );
  }
  if (extension === '.docx' && part.startsWith('word/')) {
    assertPolicy(!ACTIVE_FIELD.test(xml), 'Office document contains an active field code');
  }
  return activeDefaultExtensions;
}

function readXmlAttribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match?.[1];
}

function assertPolicy(condition: unknown, message: string): asserts condition {
  if (!condition) throw new OoxmlSecurityError(message);
}
