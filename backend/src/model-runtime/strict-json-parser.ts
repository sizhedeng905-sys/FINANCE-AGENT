export type StrictJsonErrorCode =
  | 'SIZE_LIMIT'
  | 'DEPTH_LIMIT'
  | 'NODE_LIMIT'
  | 'ARRAY_LIMIT'
  | 'STRING_LIMIT'
  | 'DUPLICATE_KEY'
  | 'FORBIDDEN_KEY'
  | 'FORBIDDEN_CHARACTER'
  | 'EXPONENT_NUMBER'
  | 'INVALID_JSON';

export class StrictJsonError extends Error {
  constructor(readonly code: StrictJsonErrorCode, message: string) {
    super(message);
  }
}

export interface StrictJsonLimits {
  maxBytes?: number;
  maxDepth?: number;
  maxNodes?: number;
  maxArrayLength?: number;
  maxStringLength?: number;
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function parseStrictJson(text: string, limits: StrictJsonLimits = {}): unknown {
  const parser = new StrictJsonParser(text, {
    maxBytes: limits.maxBytes ?? 64 * 1024,
    maxDepth: limits.maxDepth ?? 32,
    maxNodes: limits.maxNodes ?? 10_000,
    maxArrayLength: limits.maxArrayLength ?? 1_000,
    maxStringLength: limits.maxStringLength ?? 10_000
  });
  return parser.parse();
}

class StrictJsonParser {
  private index = 0;
  private nodes = 0;

  constructor(
    private readonly text: string,
    private readonly limits: Required<StrictJsonLimits>
  ) {}

  parse() {
    if (Buffer.byteLength(this.text, 'utf8') > this.limits.maxBytes) {
      throw new StrictJsonError('SIZE_LIMIT', 'JSON exceeds byte limit');
    }
    this.skipWhitespace();
    this.scanValue(0);
    this.skipWhitespace();
    if (this.index !== this.text.length) this.fail('Unexpected trailing content');
    try {
      return JSON.parse(this.text);
    } catch {
      throw new StrictJsonError('INVALID_JSON', 'JSON syntax is invalid');
    }
  }

  private scanValue(depth: number): void {
    this.nodes += 1;
    if (this.nodes > this.limits.maxNodes) throw new StrictJsonError('NODE_LIMIT', 'JSON node limit exceeded');
    if (depth > this.limits.maxDepth) throw new StrictJsonError('DEPTH_LIMIT', 'JSON depth limit exceeded');
    const current = this.text[this.index];
    if (current === '{') return this.scanObject(depth);
    if (current === '[') return this.scanArray(depth);
    if (current === '"') {
      this.scanString();
      return;
    }
    if (current === '-' || isDigit(current)) return this.scanNumber();
    if (this.consumeLiteral('true') || this.consumeLiteral('false') || this.consumeLiteral('null')) return;
    this.fail('Expected a JSON value');
  }

  private scanObject(depth: number) {
    this.index += 1;
    this.skipWhitespace();
    if (this.consume('}')) return;
    const keys = new Set<string>();
    while (true) {
      if (this.text[this.index] !== '"') this.fail('Expected an object key');
      const key = this.scanString();
      if (FORBIDDEN_KEYS.has(key)) throw new StrictJsonError('FORBIDDEN_KEY', `Forbidden JSON key: ${key}`);
      if (keys.has(key)) throw new StrictJsonError('DUPLICATE_KEY', `Duplicate JSON key: ${key}`);
      keys.add(key);
      this.skipWhitespace();
      if (!this.consume(':')) this.fail('Expected a colon after object key');
      this.skipWhitespace();
      this.scanValue(depth + 1);
      this.skipWhitespace();
      if (this.consume('}')) return;
      if (!this.consume(',')) this.fail('Expected a comma between object members');
      this.skipWhitespace();
    }
  }

  private scanArray(depth: number) {
    this.index += 1;
    this.skipWhitespace();
    if (this.consume(']')) return;
    let length = 0;
    while (true) {
      length += 1;
      if (length > this.limits.maxArrayLength) {
        throw new StrictJsonError('ARRAY_LIMIT', 'JSON array length limit exceeded');
      }
      this.scanValue(depth + 1);
      this.skipWhitespace();
      if (this.consume(']')) return;
      if (!this.consume(',')) this.fail('Expected a comma between array items');
      this.skipWhitespace();
    }
  }

  private scanString() {
    const start = this.index;
    this.index += 1;
    while (this.index < this.text.length) {
      const character = this.text[this.index];
      if (character === '"') {
        this.index += 1;
        const source = this.text.slice(start, this.index);
        let parsed: string;
        try {
          parsed = JSON.parse(source) as string;
        } catch {
          throw new StrictJsonError('INVALID_JSON', 'JSON string escape is invalid');
        }
        if (/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(parsed)) {
          throw new StrictJsonError('FORBIDDEN_CHARACTER', 'JSON string contains a forbidden control character');
        }
        if (parsed.length > this.limits.maxStringLength) {
          throw new StrictJsonError('STRING_LIMIT', 'JSON string length limit exceeded');
        }
        return parsed;
      }
      if (character === '\\') {
        this.index += 1;
        const escaped = this.text[this.index];
        if (escaped === 'u') {
          const unicode = this.text.slice(this.index + 1, this.index + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(unicode)) this.fail('Invalid Unicode escape');
          this.index += 5;
          continue;
        }
        if (!escaped || !'"\\/bfnrt'.includes(escaped)) this.fail('Invalid string escape');
        this.index += 1;
        continue;
      }
      if (character.charCodeAt(0) < 0x20) this.fail('Unescaped control character in string');
      this.index += 1;
    }
    this.fail('Unterminated JSON string');
  }

  private scanNumber() {
    if (this.consume('-') && !isDigit(this.text[this.index])) this.fail('Invalid number');
    if (this.consume('0')) {
      if (isDigit(this.text[this.index])) this.fail('Leading zero is not allowed');
    } else {
      if (!isNonZeroDigit(this.text[this.index])) this.fail('Invalid number');
      while (isDigit(this.text[this.index])) this.index += 1;
    }
    if (this.consume('.')) {
      if (!isDigit(this.text[this.index])) this.fail('Fraction requires digits');
      while (isDigit(this.text[this.index])) this.index += 1;
    }
    if (this.text[this.index] === 'e' || this.text[this.index] === 'E') {
      throw new StrictJsonError('EXPONENT_NUMBER', 'Exponent numbers are not allowed');
    }
  }

  private consumeLiteral(value: string) {
    if (!this.text.startsWith(value, this.index)) return false;
    this.index += value.length;
    return true;
  }

  private consume(value: string) {
    if (this.text[this.index] !== value) return false;
    this.index += 1;
    return true;
  }

  private skipWhitespace() {
    while ([' ', '\n', '\r', '\t'].includes(this.text[this.index])) this.index += 1;
  }

  private fail(message: string): never {
    throw new StrictJsonError('INVALID_JSON', `${message} at offset ${this.index}`);
  }
}

function isDigit(value: string | undefined): value is string {
  return value !== undefined && value >= '0' && value <= '9';
}

function isNonZeroDigit(value: string | undefined): value is string {
  return value !== undefined && value >= '1' && value <= '9';
}
