import {
  CANONICAL_JSON_VERSION,
  canonicalJson,
  canonicalJsonSha256
} from '../src/common/utils/canonical-json';

describe('versioned canonical JSON', () => {
  it('produces the same digest for equivalent object key orders without changing array order', () => {
    const first = { z: ['2.00', '1.00'], nested: { b: true, a: null } };
    const reordered = { nested: { a: null, b: true }, z: ['2.00', '1.00'] };
    const changedArray = { nested: { a: null, b: true }, z: ['1.00', '2.00'] };

    expect(CANONICAL_JSON_VERSION).toBe('stable-json-v1');
    expect(canonicalJson(first)).toBe('{"nested":{"a":null,"b":true},"z":["2.00","1.00"]}');
    expect(canonicalJsonSha256(first)).toBe(canonicalJsonSha256(reordered));
    expect(canonicalJsonSha256(first)).not.toBe(canonicalJsonSha256(changedArray));
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite number %p',
    (value) => expect(() => canonicalJson({ value })).toThrow('non-finite')
  );

  it('rejects undefined, prototype-pollution keys, cycles, and excessive nesting', () => {
    expect(() => canonicalJson({ value: undefined })).toThrow('undefined');
    expect(() => canonicalJson(JSON.parse('{"__proto__":{"polluted":true}}'))).toThrow('forbidden key');

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow('cyclic');

    expect(() => canonicalJson({ one: { two: { three: true } } }, { maxDepth: 2 })).toThrow('depth');
  });
});
