import { ImportTasksService } from '../src/import-tasks/import-tasks.service';
import { OcrTasksService } from '../src/ocr/ocr-tasks.service';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('worker shutdown', () => {
  it.each([
    ['OCR', OcrTasksService],
    ['import', ImportTasksService]
  ])('waits for active %s recovery and background jobs', async (_label, Service) => {
    const recovery = deferred();
    const background = deferred();
    const service = Object.create(Service.prototype) as {
      stopping: boolean;
      leaseReaper?: NodeJS.Timeout;
      recoveryJob?: Promise<void>;
      backgroundJobs: Map<string, Promise<void>>;
      onModuleDestroy(): Promise<void>;
    };
    service.stopping = false;
    service.recoveryJob = recovery.promise;
    service.backgroundJobs = new Map([['job', background.promise]]);
    let settled = false;

    const shutdown = service.onModuleDestroy().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(service.stopping).toBe(true);
    expect(settled).toBe(false);

    recovery.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    background.resolve();
    await shutdown;
    expect(settled).toBe(true);
  });
});
