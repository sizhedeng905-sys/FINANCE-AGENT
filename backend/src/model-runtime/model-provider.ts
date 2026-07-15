export interface ModelProviderSnapshot {
  provider: string;
  modelName: string;
  modelVersion?: string;
  endpoint?: string;
}

export interface ModelHealthResult {
  healthy: boolean;
  latencyMs: number;
  error?: string;
}

export interface ModelProvider<TInput, TOutput> {
  snapshot(): ModelProviderSnapshot;
  health(): Promise<ModelHealthResult>;
  invoke(input: TInput): Promise<TOutput>;
}
