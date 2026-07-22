import { BadGatewayException, Injectable } from '@nestjs/common';
import Ajv, { ErrorObject, JSONSchemaType } from 'ajv';

import { canonicalJson } from '../common/utils/canonical-json';
import { parseStrictJson, StrictJsonError, StrictJsonLimits } from './strict-json-parser';

@Injectable()
export class StructuredOutputValidatorService {
  private readonly ajv = new Ajv({ allErrors: true, strict: true, ownProperties: true });

  validate<T>(schema: JSONSchemaType<T>, value: unknown): T {
    try {
      canonicalJson(value, { maxDepth: 64, maxNodes: 200_000 });
    } catch {
      throw new BadGatewayException('模型结构化输出包含不安全 JSON 值');
    }
    const validate = this.ajv.compile(schema);
    if (!validate(value)) throw new BadGatewayException(`模型结构化输出不合法：${this.formatErrors(validate.errors)}`);
    return value as T;
  }

  parseAndValidate<T>(schema: JSONSchemaType<T>, text: string, limits?: StrictJsonLimits): T {
    let value: unknown;
    try {
      value = parseStrictJson(text, limits);
    } catch (error) {
      const category = error instanceof StrictJsonError ? error.code : 'INVALID_JSON';
      throw new BadGatewayException(`模型未返回严格 JSON（${category}）`);
    }
    return this.validate(schema, value);
  }

  private formatErrors(errors: ErrorObject[] | null | undefined) {
    return (errors ?? []).slice(0, 5).map((error) => `${error.instancePath || '/'} ${error.message ?? 'invalid'}`).join('；');
  }
}
