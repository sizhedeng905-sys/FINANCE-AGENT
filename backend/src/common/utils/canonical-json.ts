import { createHash } from 'node:crypto';

export const CANONICAL_JSON_VERSION = 'stable-json-v1';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export interface CanonicalJsonOptions {
  maxDepth?: number;
  maxNodes?: number;
}

interface CanonicalJsonState {
  readonly maxDepth: number;
  readonly maxNodes: number;
  nodes: number;
  readonly ancestors: Set<object>;
}

export function canonicalJson(value: unknown, options: CanonicalJsonOptions = {}): string {
  const state: CanonicalJsonState = {
    maxDepth: options.maxDepth ?? 64,
    maxNodes: options.maxNodes ?? 100_000,
    nodes: 0,
    ancestors: new Set<object>()
  };
  return JSON.stringify(normalizeCanonicalValue(value, 0, state));
}

export function canonicalJsonSha256(value: unknown, options?: CanonicalJsonOptions): string {
  return createHash('sha256').update(canonicalJson(value, options), 'utf8').digest('hex');
}

function normalizeCanonicalValue(value: unknown, depth: number, state: CanonicalJsonState): unknown {
  state.nodes += 1;
  if (state.nodes > state.maxNodes) throw new TypeError('Canonical JSON node limit exceeded');
  if (depth > state.maxDepth) throw new TypeError('Canonical JSON depth limit exceeded');

  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON rejects non-finite numbers');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') throw new TypeError(`Canonical JSON rejects ${typeof value} values`);

  if (state.ancestors.has(value)) throw new TypeError('Canonical JSON rejects cyclic values');
  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => normalizeCanonicalValue(item, depth + 1, state));
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Canonical JSON accepts only plain objects and arrays');
    }
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(source).sort()) {
      if (FORBIDDEN_KEYS.has(key)) throw new TypeError(`Canonical JSON rejects forbidden key: ${key}`);
      if (source[key] === undefined) throw new TypeError(`Canonical JSON rejects undefined at key: ${key}`);
      result[key] = normalizeCanonicalValue(source[key], depth + 1, state);
    }
    return result;
  } finally {
    state.ancestors.delete(value);
  }
}
