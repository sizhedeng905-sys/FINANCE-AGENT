import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  BusinessRecordStatus,
  DataRecordType,
  FieldType,
  ImportRowStatus,
  ImportTaskStatus,
  MappingDecisionType,
  OcrAttemptStatus,
  OcrTaskStatus,
  Prisma,
  RecordSourceType,
  WorkOrderStatus,
  WorkOrderType
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';
import { PrismaService } from '../../src/prisma/prisma.service';

interface HttpResult {
  status: number;
  body: {
    code?: number;
    message?: string;
    data?: Record<string, unknown>;
  };
}

describe('project-template lifecycle serialization', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let financeToken: string;
  let bossToken: string;
  let projectId: string;
  let templateId: string;
  let bindingId: string;
  let dateFieldId: string;
  let amountFieldId: string;
  let importTaskId: string;
  let ocrTaskId: string;
  let workOrderId: string;
  const rawFileIds: string[] = [];
  const suffix = randomUUID();

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true }
    }));
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
    prisma = app.get(PrismaService);

    const [financeLogin, bossLogin] = await Promise.all([
      request(app.getHttpServer()).post('/api/auth/login').send({ username: 'finance', password: '123456' }),
      request(app.getHttpServer()).post('/api/auth/login').send({ username: 'boss', password: '123456' })
    ]);
    expect(financeLogin.status).toBe(200);
    expect(bossLogin.status).toBe(200);
    financeToken = financeLogin.body.data.accessToken as string;
    bossToken = bossLogin.body.data.accessToken as string;

    const [finance, employee, dateField, amountField] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { username: 'finance' } }),
      prisma.user.findUniqueOrThrow({ where: { username: 'employee' } }),
      prisma.fieldDefinition.findUniqueOrThrow({ where: { fieldKey: 'date' } }),
      prisma.fieldDefinition.findUniqueOrThrow({ where: { fieldKey: 'amount' } })
    ]);
    expect(dateField.fieldType).toBe(FieldType.date);
    expect(amountField.fieldType).toBe(FieldType.money);
    dateFieldId = dateField.id;
    amountFieldId = amountField.id;

    const project = await prisma.project.create({
      data: {
        name: `integration_template_serialization_${suffix}`,
        customerName: 'Synthetic concurrency customer',
        ownerName: 'Synthetic concurrency owner',
        createdBy: finance.username
      }
    });
    projectId = project.id;
    const template = await prisma.template.create({
      data: {
        name: `integration_template_serialization_${suffix}`,
        recordType: DataRecordType.reimbursement,
        primaryDateFieldId: dateField.id,
        primaryAmountFieldId: amountField.id,
        createdBy: finance.username
      }
    });
    templateId = template.id;
    await prisma.templateField.createMany({
      data: [
        { templateId, fieldId: dateField.id, isRequired: true, isVisible: true, displayOrder: 1 },
        { templateId, fieldId: amountField.id, isRequired: true, isVisible: true, displayOrder: 2 }
      ]
    });
    const binding = await prisma.projectTemplate.create({
      data: {
        projectId,
        templateId,
        recordType: DataRecordType.reimbursement,
        customName: 'Synthetic serialized template'
      }
    });
    bindingId = binding.id;

    const createRawFile = async (label: string) => {
      const digest = createHash('sha256').update(`${suffix}:${label}`).digest('hex');
      const rawFile = await prisma.rawFile.create({
        data: {
          fileName: `${label}-${suffix}.pdf`,
          originalFileName: `${label}.pdf`,
          fileType: 'pdf',
          mimeType: 'application/pdf',
          fileSize: 128n,
          storagePath: `integration/project-template-lock/${label}-${suffix}.pdf`,
          sha256: digest,
          uploadedBy: finance.id,
          relatedProjectId: projectId,
          scanStatus: 'clean'
        }
      });
      rawFileIds.push(rawFile.id);
      return rawFile;
    };

    const importFile = await createRawFile('import');
    const importTask = await prisma.importTask.create({
      data: {
        projectId,
        templateId,
        templateVersion: template.version,
        templateSnapshot: { schemaVersion: 1, templateId, version: template.version },
        rawFileId: importFile.id,
        fileName: 'serialized-import.xlsx',
        importType: DataRecordType.reimbursement,
        status: ImportTaskStatus.pending_confirm,
        uploadedBy: finance.id,
        parsedAt: new Date(),
        totalRows: 1,
        validRows: 1,
        processedRows: 1
      }
    });
    importTaskId = importTask.id;
    const sheet = await prisma.importSheet.create({
      data: {
        importTaskId,
        sheetName: 'Sheet1',
        sheetIndex: 0,
        headerRowIndex: 1,
        rowCount: 1
      }
    });
    const [dateColumn, amountColumn] = await Promise.all([
      prisma.importColumn.create({
        data: {
          importTaskId,
          sheetId: sheet.id,
          columnIndex: 0,
          sourceKey: 'date',
          sourceName: 'date',
          normalizedName: 'date',
          inferredType: 'date'
        }
      }),
      prisma.importColumn.create({
        data: {
          importTaskId,
          sheetId: sheet.id,
          columnIndex: 1,
          sourceKey: 'amount',
          sourceName: 'amount',
          normalizedName: 'amount',
          inferredType: 'number'
        }
      })
    ]);
    await prisma.mappingDecision.createMany({
      data: [
        {
          importTaskId,
          importColumnId: dateColumn.id,
          targetFieldId: dateField.id,
          mappingType: MappingDecisionType.manual,
          confidence: new Prisma.Decimal(1),
          confirmedBy: finance.id
        },
        {
          importTaskId,
          importColumnId: amountColumn.id,
          targetFieldId: amountField.id,
          mappingType: MappingDecisionType.manual,
          confidence: new Prisma.Decimal(1),
          confirmedBy: finance.id
        }
      ]
    });
    await prisma.importRow.create({
      data: {
        importTaskId,
        sheetId: sheet.id,
        rowNumber: 2,
        rawData: { date: '2026-07-18', amount: '202.00' },
        rowHash: createHash('sha256').update(`${suffix}:import-row`).digest('hex'),
        status: ImportRowStatus.pending
      }
    });

    const ocrFile = await createRawFile('ocr');
    const candidates = [
      {
        fieldId: dateField.id,
        fieldKey: dateField.fieldKey,
        fieldName: dateField.fieldName,
        fieldType: dateField.fieldType,
        semanticType: dateField.semanticType,
        isRequired: true,
        sourceLabel: 'date',
        rawValue: '2026-07-18',
        normalizedValue: '2026-07-18',
        page: 1,
        confidence: 1,
        evidence: 'synthetic date evidence',
        missing: false,
        lowConfidence: false,
        corrected: false
      },
      {
        fieldId: amountField.id,
        fieldKey: amountField.fieldKey,
        fieldName: amountField.fieldName,
        fieldType: amountField.fieldType,
        semanticType: amountField.semanticType,
        isRequired: true,
        sourceLabel: 'amount',
        rawValue: '303.00',
        normalizedValue: '303.00',
        page: 1,
        confidence: 1,
        evidence: 'synthetic amount evidence',
        missing: false,
        lowConfidence: false,
        corrected: false
      }
    ];
    const ocrTask = await prisma.ocrTask.create({
      data: {
        rawFileId: ocrFile.id,
        projectId,
        templateId,
        templateVersion: template.version,
        templateSnapshot: { schemaVersion: 1, templateId, version: template.version },
        status: OcrTaskStatus.pending_confirm,
        provider: 'mock',
        modelName: 'synthetic-lock-test',
        modelVersion: '1',
        extractedText: 'date 2026-07-18 amount 303.00',
        extractedFields: {
          [dateField.id]: '2026-07-18',
          [amountField.id]: '303.00'
        },
        fieldConfidence: {
          [dateField.id]: 1,
          [amountField.id]: 1
        },
        pages: [{ page: 1, width: 100, height: 100, rotation: 0 }],
        textBlocks: [],
        tables: [],
        fieldCandidates: candidates,
        pageCount: 1,
        avgConfidence: new Prisma.Decimal(1),
        attemptCount: 1,
        uploadedBy: finance.id
      }
    });
    ocrTaskId = ocrTask.id;
    await prisma.ocrAttempt.create({
      data: {
        ocrTaskId,
        attemptNo: 1,
        status: OcrAttemptStatus.succeeded,
        provider: 'mock',
        modelName: 'synthetic-lock-test',
        modelVersion: '1',
        inputSha256: ocrFile.sha256,
        correlationId: `ocr-lock-${suffix}`,
        startedAt: new Date(),
        completedAt: new Date(),
        pageCount: 1
      }
    });

    const workOrder = await prisma.workOrder.create({
      data: {
        orderNo: `WO-LOCK-${suffix}`,
        type: WorkOrderType.expense,
        projectId,
        templateId,
        templateVersion: template.version,
        templateSnapshot: { schemaVersion: 1, templateId, version: template.version },
        submissionSnapshot: { schemaVersion: 1, projectId, templateId, version: template.version },
        projectName: project.name,
        customerName: project.customerName,
        creatorId: employee.id,
        creatorName: employee.name,
        amount: '404.00',
        status: WorkOrderStatus.boss_pending,
        description: 'Synthetic serialized boss approval',
        occurredDate: new Date('2026-07-18T00:00:00.000Z')
      }
    });
    workOrderId = workOrder.id;
  });

  beforeEach(async () => {
    await prisma.projectTemplate.update({ where: { id: bindingId }, data: { isActive: true } });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.projectTemplate.updateMany({ where: { id: bindingId }, data: { isActive: true } });
      await prisma.idempotencyKey.deleteMany({ where: { key: { contains: suffix } } });
      const records = projectId
        ? await prisma.businessRecord.findMany({ where: { projectId }, select: { id: true } })
        : [];
      const resourceIds = [
        projectId,
        templateId,
        bindingId,
        importTaskId,
        ocrTaskId,
        workOrderId,
        ...rawFileIds,
        ...records.map((record) => record.id)
      ].filter((id): id is string => Boolean(id));
      if (records.length) {
        await prisma.businessRecord.deleteMany({ where: { id: { in: records.map((record) => record.id) } } });
      }
      if (workOrderId) await prisma.workOrder.deleteMany({ where: { id: workOrderId } });
      if (ocrTaskId) await prisma.ocrTask.deleteMany({ where: { id: ocrTaskId } });
      if (importTaskId) await prisma.importTask.deleteMany({ where: { id: importTaskId } });
      if (rawFileIds.length) await prisma.rawFile.deleteMany({ where: { id: { in: rawFileIds } } });
      if (projectId) await prisma.project.deleteMany({ where: { id: projectId } });
      if (templateId) await prisma.template.deleteMany({ where: { id: templateId } });
      if (resourceIds.length) {
        await prisma.auditLog.deleteMany({ where: { resourceId: { in: resourceIds } } });
        await prisma.ledgerEvent.deleteMany({ where: { aggregateId: { in: resourceIds } } });
      }
    }
    if (app) await app.close();
  });

  const holdProjectLock = async () => {
    let release!: () => void;
    let announce!: () => void;
    const held = new Promise<void>((resolve) => { announce = resolve; });
    const pause = new Promise<void>((resolve) => { release = resolve; });
    const done = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${projectId}, 22))`;
      announce();
      await pause;
    }, { timeout: 10_000 });
    await held;
    return { release, done };
  };

  const expectWaiting = async (pending: Promise<HttpResult>) => {
    const state = await Promise.race([
      pending.then(() => 'settled' as const, () => 'settled' as const),
      new Promise<'waiting'>((resolve) => setTimeout(() => resolve('waiting'), 150))
    ]);
    expect(state).toBe('waiting');
  };

  const runSerialized = async (
    first: () => PromiseLike<HttpResult>,
    second: () => PromiseLike<HttpResult>
  ) => {
    const lock = await holdProjectLock();
    let firstPromise: Promise<HttpResult> | undefined;
    let secondPromise: Promise<HttpResult> | undefined;
    try {
      firstPromise = Promise.resolve(first());
      await expectWaiting(firstPromise);
      secondPromise = Promise.resolve(second());
      await expectWaiting(secondPromise);
      lock.release();
      await lock.done;
      return await Promise.all([firstPromise, secondPromise]);
    } finally {
      lock.release();
      await lock.done.catch(() => undefined);
    }
  };

  const disableTemplate = () => request(app.getHttpServer())
    .patch(`/api/project-templates/${bindingId}/disable`)
    .set('Authorization', `Bearer ${financeToken}`)
    .then((response) => response as HttpResult);

  it('serializes template enable before a manual business-record write', async () => {
    await prisma.projectTemplate.update({ where: { id: bindingId }, data: { isActive: false } });
    const description = `R6.2 manual enable race ${suffix}`;
    const [enabled, created] = await runSerialized(
      () => request(app.getHttpServer())
        .post(`/api/projects/${projectId}/templates`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({ templateId })
        .then((response) => response as HttpResult),
      () => request(app.getHttpServer())
        .post('/api/records')
        .set('Authorization', `Bearer ${financeToken}`)
        .set('Idempotency-Key', `r6-enable-record-${suffix}`)
        .send({
          projectId,
          templateId,
          recordType: DataRecordType.reimbursement,
          recordDate: '2026-07-18',
          amount: '101.00',
          sourceType: RecordSourceType.manual,
          sourceId: 'manual',
          status: BusinessRecordStatus.pending_confirm,
          description,
          values: [
            { fieldId: dateFieldId, value: '2026-07-18' },
            { fieldId: amountFieldId, value: '101.00' }
          ],
          attachments: []
        })
        .then((response) => response as HttpResult)
    );

    expect(enabled.status).toBe(201);
    expect(created.status).toBe(201);
    expect(await prisma.projectTemplate.findUniqueOrThrow({ where: { id: bindingId } }))
      .toMatchObject({ isActive: true });
    expect(await prisma.businessRecord.count({ where: { projectId, description } })).toBe(1);
  });

  it('prevents an Excel confirmation worker from writing after template disable wins the next lock', async () => {
    const [scheduled, disabled] = await runSerialized(
      () => request(app.getHttpServer())
        .post(`/api/import-tasks/${importTaskId}/confirm`)
        .set('Authorization', `Bearer ${financeToken}`)
        .set('Idempotency-Key', `r6-import-confirm-${suffix}`)
        .then((response) => response as HttpResult),
      disableTemplate
    );

    expect(scheduled.status).toBe(201);
    expect(disabled.status).toBe(200);
    const deadline = Date.now() + 10_000;
    let task = await prisma.importTask.findUniqueOrThrow({ where: { id: importTaskId } });
    while (
      task.status !== ImportTaskStatus.confirmed &&
      task.status !== ImportTaskStatus.confirmation_failed &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      task = await prisma.importTask.findUniqueOrThrow({ where: { id: importTaskId } });
    }
    expect(task.status).toBe(ImportTaskStatus.confirmation_failed);
    expect(await prisma.businessRecord.count({ where: { importTaskId } })).toBe(0);
  });

  it('rejects OCR record confirmation when template disable is serialized first', async () => {
    const [disabled, confirmed] = await runSerialized(
      disableTemplate,
      () => request(app.getHttpServer())
        .post(`/api/ocr-tasks/${ocrTaskId}/confirm`)
        .set('Authorization', `Bearer ${financeToken}`)
        .set('Idempotency-Key', `r6-ocr-confirm-${suffix}`)
        .send({
          expectedVersion: 1,
          expectedReviewRevision: 0,
          expectedValidationSnapshotHash: '0'.repeat(64),
          expectedPayloadHash: '0'.repeat(64),
          acknowledgedWarningIds: []
        })
        .then((response) => response as HttpResult)
    );

    expect(disabled.status).toBe(200);
    expect(confirmed.status).toBe(400);
    expect(await prisma.ocrTask.findUniqueOrThrow({ where: { id: ocrTaskId } }))
      .toMatchObject({ status: OcrTaskStatus.pending_confirm, generatedRecordId: null });
    expect(await prisma.businessRecord.count({ where: { sourceType: RecordSourceType.ocr, sourceId: ocrTaskId } }))
      .toBe(0);
  });

  it('commits a boss-approved record before a later serialized template disable', async () => {
    const [approved, disabled] = await runSerialized(
      () => request(app.getHttpServer())
        .post(`/api/work-orders/${workOrderId}/boss-approve`)
        .set('Authorization', `Bearer ${bossToken}`)
        .set('Idempotency-Key', `r6-work-order-approve-${suffix}`)
        .send({ action: 'approve', comment: 'Synthetic serialized approval' })
        .then((response) => response as HttpResult),
      disableTemplate
    );

    expect(approved.status).toBe(201);
    expect(disabled.status).toBe(200);
    expect(await prisma.workOrder.findUniqueOrThrow({ where: { id: workOrderId } }))
      .toMatchObject({ status: WorkOrderStatus.completed, generatedRecordId: expect.any(String) });
    expect(await prisma.businessRecord.count({
      where: { sourceType: RecordSourceType.work_order, sourceId: workOrderId }
    })).toBe(1);
    expect(await prisma.projectTemplate.findUniqueOrThrow({ where: { id: bindingId } }))
      .toMatchObject({ isActive: false });
  });
});
