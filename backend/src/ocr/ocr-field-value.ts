import { BadRequestException } from '@nestjs/common';
import { FieldDefinition, FieldType, Prisma } from '@prisma/client';

export function normalizeOcrFieldValue(
  field: FieldDefinition,
  raw: unknown,
  rawFileId: string
): string | string[] {
  if (isEmptyOcrFieldValue(raw)) throw new BadRequestException('Value cannot be empty');
  if (field.fieldType === FieldType.number || field.fieldType === FieldType.money) {
    if (typeof raw !== 'string') {
      throw new BadRequestException('Precision-sensitive numbers must be submitted as strings');
    }
    const text = raw.trim().replace(/,/g, '');
    if (!/^-?(?:\d+|\d*\.\d+)$/.test(text)) {
      throw new BadRequestException('Invalid numeric format');
    }
    const decimal = new Prisma.Decimal(text);
    if (field.fieldType === FieldType.money && decimal.decimalPlaces() > 2) {
      throw new BadRequestException('Money values support at most two decimal places');
    }
    if (decimal.abs().greaterThan('99999999999999.99')) {
      throw new BadRequestException('Numeric value exceeds the allowed range');
    }
    return decimal.toString();
  }
  if (field.fieldType === FieldType.date) {
    if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      throw new BadRequestException('Date must use YYYY-MM-DD format');
    }
    const date = new Date(`${raw}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
      throw new BadRequestException('Invalid date');
    }
    return raw;
  }
  if (field.fieldType === FieldType.file) {
    if (!Array.isArray(raw) || raw.length !== 1 || raw[0] !== rawFileId) {
      throw new BadRequestException('File fields must reference the current OCR source file');
    }
    return [rawFileId];
  }
  if (typeof raw !== 'string') throw new BadRequestException('Text fields must be strings');
  const value = raw.trim();
  const maxLength = field.fieldType === FieldType.textarea ? 5000 : 1000;
  if (!value || value.length > maxLength) {
    throw new BadRequestException(`Text length must be between 1 and ${maxLength}`);
  }
  return value;
}

export function isEmptyOcrFieldValue(value: unknown) {
  return value === null
    || value === undefined
    || value === ''
    || (Array.isArray(value) && value.length === 0);
}
