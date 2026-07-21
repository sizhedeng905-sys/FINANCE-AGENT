import { Prisma } from '@prisma/client';

export const AI_PROMPT_INPUT_NORMALIZER_VERSION = 'ai-prompt-json/1.0';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export interface AiPromptInputNormalizerOptions {
  maxDepth?: number;
  maxNodes?: number;
}

interface NormalizerState {
  readonly maxDepth: number;
  readonly maxNodes: number;
  nodes: number;
  readonly ancestors: Set<object>;
}

export function normalizeAiPromptInput(
  value: unknown,
  options: AiPromptInputNormalizerOptions = {}
): Prisma.JsonValue {
  const state: NormalizerState = {
    maxDepth: options.maxDepth ?? 64,
    maxNodes: options.maxNodes ?? 100_000,
    nodes: 0,
    ancestors: new Set<object>()
  };
  const normalized = normalizeValue(value, 0, state);
  if (normalized === undefined) throw new TypeError('AI prompt input cannot be undefined');
  return normalized;
}

function normalizeValue(
  value: unknown,
  depth: number,
  state: NormalizerState
): Prisma.JsonValue | undefined {
  state.nodes += 1;
  if (state.nodes > state.maxNodes) throw new TypeError('AI prompt input node limit exceeded');
  if (depth > state.maxDepth) throw new TypeError('AI prompt input depth limit exceeded');

  if (value === undefined) return undefined;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('AI prompt input rejects non-finite numbers');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') throw new TypeError(`AI prompt input rejects ${typeof value} values`);

  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new TypeError('AI prompt input rejects invalid dates');
    return value.toISOString();
  }
  if (Prisma.Decimal.isDecimal(value)) return value.toString();
  if (state.ancestors.has(value)) throw new TypeError('AI prompt input rejects cyclic values');

  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => {
        const normalized = normalizeValue(item, depth + 1, state);
        if (normalized === undefined) throw new TypeError('AI prompt input rejects undefined array entries');
        return normalized;
      });
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('AI prompt input accepts only supported values and plain objects');
    }
    const source = value as Record<string, unknown>;
    const result: Prisma.JsonObject = {};
    for (const key of Object.keys(source).sort()) {
      if (FORBIDDEN_KEYS.has(key)) throw new TypeError(`AI prompt input rejects forbidden key: ${key}`);
      const normalized = normalizeValue(source[key], depth + 1, state);
      if (normalized !== undefined) result[key] = normalized;
    }
    return result;
  } finally {
    state.ancestors.delete(value);
  }
}
