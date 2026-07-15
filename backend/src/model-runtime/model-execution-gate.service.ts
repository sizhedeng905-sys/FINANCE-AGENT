import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface GateState {
  active: number;
  queue: Array<() => void>;
}

@Injectable()
export class ModelExecutionGateService {
  private readonly states = new Map<string, GateState>();
  private readonly maxQueue: number;

  constructor(config: ConfigService) {
    this.maxQueue = config.get<number>('modelRuntime.maxQueue') ?? 20;
  }

  async run<T>(key: string, maxConcurrency: number, operation: () => Promise<T>): Promise<T> {
    await this.acquire(key, Math.max(1, maxConcurrency));
    try {
      return await operation();
    } finally {
      this.release(key);
    }
  }

  snapshot() {
    return Object.fromEntries([...this.states].map(([key, state]) => [key, { active: state.active, queued: state.queue.length }]));
  }

  private async acquire(key: string, maxConcurrency: number) {
    const state = this.state(key);
    if (state.active < maxConcurrency) {
      state.active += 1;
      return;
    }
    if (state.queue.length >= this.maxQueue) throw new ServiceUnavailableException('模型任务队列已满，请稍后重试或转人工处理');
    await new Promise<void>((resolve) => state.queue.push(resolve));
    state.active += 1;
  }

  private release(key: string) {
    const state = this.state(key);
    state.active = Math.max(0, state.active - 1);
    state.queue.shift()?.();
  }

  private state(key: string) {
    let state = this.states.get(key);
    if (!state) {
      state = { active: 0, queue: [] };
      this.states.set(key, state);
    }
    return state;
  }
}
