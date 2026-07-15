import { existsSync } from 'node:fs';
import { readdir, rm, unlink } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { PrismaClient } from '@prisma/client';

const backendRoot = resolve(import.meta.dirname, '..');
const envFile = resolve(backendRoot, process.env.TEST_ENV_FILE || '.env.test');

if (existsSync(envFile)) {
  loadEnvFile(envFile);
}

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL or DATABASE_URL is required for E2E cleanup.');
}

const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
if (!databaseName.endsWith('_test')) {
  throw new Error(`E2E cleanup refuses to use non-test database "${databaseName}".`);
}

process.env.DATABASE_URL = databaseUrl;
const prisma = new PrismaClient();
const testUploadRoot = resolve(backendRoot, 'test-uploads');
const uploadRoot = resolve(backendRoot, process.env.E2E_UPLOAD_DIR || 'test-uploads/e2e');
const uploadRootRelative = relative(testUploadRoot, uploadRoot);
if (!uploadRootRelative || uploadRootRelative.startsWith('..') || isAbsolute(uploadRootRelative)) {
  throw new Error('E2E upload root must be a dedicated child of backend/test-uploads.');
}

function resolveStoredFile(storagePath) {
  if (isAbsolute(storagePath)) throw new Error(`Refusing to remove absolute storage path: ${storagePath}`);
  const candidate = resolve(uploadRoot, storagePath);
  const fromRoot = relative(uploadRoot, candidate);
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error(`Refusing to remove storage path outside E2E upload root: ${storagePath}`);
  }
  return candidate;
}

async function main() {
  const [workOrders, importTasks, ocrTasks] = await Promise.all([
    prisma.workOrder.findMany({
      where: { description: { startsWith: 'E2E ' } },
      select: {
        id: true,
        generatedRecordId: true,
        rawFiles: { select: { id: true, storagePath: true } },
        attachments: { select: { rawFile: { select: { id: true, storagePath: true } } } }
      }
    }),
    prisma.importTask.findMany({
      where: { fileName: { startsWith: 'E2E ' } },
      select: {
        id: true,
        rawFile: { select: { id: true, storagePath: true } },
        businessRecords: { select: { id: true } }
      }
    }),
    prisma.ocrTask.findMany({
      where: { rawFile: { originalFileName: { startsWith: 'E2E ' } } },
      select: {
        id: true,
        rawFile: { select: { id: true, storagePath: true } },
        generatedRecordId: true
      }
    })
  ]);

  const workOrderIds = workOrders.map((item) => item.id);
  const importTaskIds = importTasks.map((item) => item.id);
  const ocrTaskIds = ocrTasks.map((item) => item.id);
  const generatedRecordIds = workOrders
    .map((item) => item.generatedRecordId)
    .filter((id) => typeof id === 'string');
  const files = new Map();
  for (const workOrder of workOrders) {
    for (const file of workOrder.rawFiles) files.set(file.id, file.storagePath);
    for (const attachment of workOrder.attachments) {
      files.set(attachment.rawFile.id, attachment.rawFile.storagePath);
    }
  }
  for (const task of importTasks) files.set(task.rawFile.id, task.rawFile.storagePath);
  for (const task of ocrTasks) files.set(task.rawFile.id, task.rawFile.storagePath);
  const rawFileIds = [...files.keys()];
  const importedRecordIds = importTasks.flatMap((task) => task.businessRecords.map((record) => record.id));
  const ocrRecordIds = ocrTasks.map((task) => task.generatedRecordId).filter((id) => typeof id === 'string');
  const records = await prisma.businessRecord.findMany({
    where: {
      OR: [
        { id: { in: [...generatedRecordIds, ...importedRecordIds, ...ocrRecordIds] } },
        { sourceId: { in: workOrderIds } }
      ]
    },
    select: { id: true }
  });
  const recordIds = records.map((item) => item.id);
  const resourceIds = [...new Set([...workOrderIds, ...importTaskIds, ...ocrTaskIds, ...recordIds, ...rawFileIds])];

  await prisma.$transaction(async (tx) => {
    await tx.workOrder.updateMany({
      where: { id: { in: workOrderIds } },
      data: { generatedRecordId: null }
    });
    await tx.workOrder.deleteMany({ where: { id: { in: workOrderIds } } });
    await tx.businessRecord.deleteMany({ where: { id: { in: recordIds } } });
    await tx.importTask.deleteMany({ where: { id: { in: importTaskIds } } });
    await tx.ocrTask.deleteMany({ where: { id: { in: ocrTaskIds } } });
    await tx.rawFile.deleteMany({ where: { id: { in: rawFileIds } } });
    await tx.mappingProfileRule.deleteMany({ where: { normalizedSourceName: { startsWith: 'e2e' } } });
    await tx.ledgerEvent.deleteMany({ where: { aggregateId: { in: resourceIds } } });
    await tx.auditLog.deleteMany({ where: { resourceId: { in: resourceIds } } });
  });

  for (const storagePath of files.values()) {
    try {
      await unlink(resolveStoredFile(storagePath));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  const orphanFilesRemoved = await countFiles(uploadRoot);
  await rm(uploadRoot, { recursive: true, force: true });

  console.log(
    `Cleaned ${workOrderIds.length} E2E work order(s), ${importTaskIds.length} import task(s), ${ocrTaskIds.length} OCR task(s), ${recordIds.length} record(s), ${rawFileIds.length} referenced file(s), and ${orphanFilesRemoved} remaining file artifact(s).`
  );
}

async function countFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return 0;
    throw error;
  }
  let count = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) count += await countFiles(resolve(directory, entry.name));
    else if (entry.isFile()) count += 1;
  }
  return count;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
