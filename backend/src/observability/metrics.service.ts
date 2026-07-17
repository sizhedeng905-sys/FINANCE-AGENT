import { Injectable } from '@nestjs/common';

interface HttpMetric {
  count: number;
  durationSeconds: number;
}

@Injectable()
export class MetricsService {
  private readonly http = new Map<string, HttpMetric>();

  recordHttp(method: string, statusCode: number, durationMs: number) {
    const normalizedMethod = /^[A-Z]{3,8}$/.test(method) ? method : 'OTHER';
    const normalizedStatus = Number.isInteger(statusCode) ? String(statusCode) : '500';
    const key = `${normalizedMethod}:${normalizedStatus}`;
    const current = this.http.get(key) ?? { count: 0, durationSeconds: 0 };
    current.count += 1;
    current.durationSeconds += Math.max(0, durationMs) / 1_000;
    this.http.set(key, current);
  }

  render(application: {
    queueDepths: Record<string, number>;
    storedFileBytes: bigint;
    workerHeartbeatAgeSeconds?: number;
    workerHeartbeatHealthy: boolean;
    modelRuntimeHealthy: boolean;
    trace: { queued: number; exported: number; dropped: number; errors: number };
  }) {
    const lines = [
      '# HELP finance_agent_http_requests_total Total HTTP responses by method and status.',
      '# TYPE finance_agent_http_requests_total counter'
    ];
    for (const [key, metric] of [...this.http.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const [method, status] = key.split(':');
      lines.push(`finance_agent_http_requests_total{method="${method}",status="${status}"} ${metric.count}`);
    }
    lines.push(
      '# HELP finance_agent_http_request_duration_seconds_sum Cumulative HTTP response duration.',
      '# TYPE finance_agent_http_request_duration_seconds_sum counter'
    );
    for (const [key, metric] of [...this.http.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const [method, status] = key.split(':');
      lines.push(
        `finance_agent_http_request_duration_seconds_sum{method="${method}",status="${status}"} ${metric.durationSeconds.toFixed(6)}`,
        `finance_agent_http_request_duration_seconds_count{method="${method}",status="${status}"} ${metric.count}`
      );
    }
    lines.push(
      '# HELP finance_agent_queue_depth Durable task queue depth.',
      '# TYPE finance_agent_queue_depth gauge'
    );
    for (const [queue, depth] of Object.entries(application.queueDepths).sort(([left], [right]) => left.localeCompare(right))) {
      lines.push(`finance_agent_queue_depth{queue="${queue}"} ${depth}`);
    }
    lines.push(
      '# HELP finance_agent_stored_file_bytes Logical bytes referenced by active raw files.',
      '# TYPE finance_agent_stored_file_bytes gauge',
      `finance_agent_stored_file_bytes ${application.storedFileBytes.toString()}`,
      '# HELP finance_agent_worker_heartbeat_healthy Whether the shared worker heartbeat is current.',
      '# TYPE finance_agent_worker_heartbeat_healthy gauge',
      `finance_agent_worker_heartbeat_healthy ${application.workerHeartbeatHealthy ? 1 : 0}`,
      '# HELP finance_agent_worker_heartbeat_age_seconds Age of the latest shared worker heartbeat.',
      '# TYPE finance_agent_worker_heartbeat_age_seconds gauge',
      `finance_agent_worker_heartbeat_age_seconds ${application.workerHeartbeatAgeSeconds?.toFixed(3) ?? '-1'}`,
      '# HELP finance_agent_model_runtime_healthy Whether the model execution gate is healthy.',
      '# TYPE finance_agent_model_runtime_healthy gauge',
      `finance_agent_model_runtime_healthy ${application.modelRuntimeHealthy ? 1 : 0}`,
      '# HELP finance_agent_trace_queue_depth Number of spans awaiting OTLP export.',
      '# TYPE finance_agent_trace_queue_depth gauge',
      `finance_agent_trace_queue_depth ${application.trace.queued}`,
      '# HELP finance_agent_trace_spans_total Trace spans by export outcome.',
      '# TYPE finance_agent_trace_spans_total counter',
      `finance_agent_trace_spans_total{outcome="exported"} ${application.trace.exported}`,
      `finance_agent_trace_spans_total{outcome="dropped"} ${application.trace.dropped}`,
      `finance_agent_trace_export_errors_total ${application.trace.errors}`,
      '# HELP process_resident_memory_bytes Resident memory size in bytes.',
      '# TYPE process_resident_memory_bytes gauge',
      `process_resident_memory_bytes ${process.memoryUsage().rss}`,
      '# HELP process_uptime_seconds Process uptime in seconds.',
      '# TYPE process_uptime_seconds gauge',
      `process_uptime_seconds ${process.uptime().toFixed(3)}`,
      ''
    );
    return lines.join('\n');
  }
}
