import { BadGatewayException, Injectable } from '@nestjs/common';
import Ajv, { ErrorObject, JSONSchemaType } from 'ajv';

@Injectable()
export class StructuredOutputValidatorService {
  private readonly ajv = new Ajv({ allErrors: true, strict: true });

  validate<T>(schema: JSONSchemaType<T>, value: unknown): T {
    const validate = this.ajv.compile(schema);
    if (!validate(value)) throw new BadGatewayException(`模型结构化输出不合法：${this.formatErrors(validate.errors)}`);
    return value as T;
  }

  parseAndValidate<T>(schema: JSONSchemaType<T>, text: string): T {
    let value: unknown;
    try {
      value = JSON.parse(this.stripCodeFence(text));
    } catch {
      throw new BadGatewayException('模型未返回合法 JSON');
    }
    return this.validate(schema, value);
  }

  private stripCodeFence(value: string) {
    return value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }

  private formatErrors(errors: ErrorObject[] | null | undefined) {
    return (errors ?? []).slice(0, 5).map((error) => `${error.instancePath || '/'} ${error.message ?? 'invalid'}`).join('；');
  }
}
