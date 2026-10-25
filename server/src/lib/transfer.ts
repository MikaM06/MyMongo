import {BSON, type Document} from 'mongodb';
import Papa from 'papaparse';
import {isPlainObject} from './mongo-syntax.js';

export const FORMATS = ['json', 'ndjson', 'csv'] as const;
export type TransferFormat = (typeof FORMATS)[number];

export interface ImportIssue {
  line: number | null;
  message: string;
}

export interface ParsedImport {
  documents: Document[];
  errors: ImportIssue[];
  total: number;
}

const MAX_ERRORS = 100;
const ISO_DATE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/;
const HEX_24 = /^[0-9a-fA-F]{24}$/;

function deserialize(value: unknown): Document {
  if (!isPlainObject(value)) {
    throw new Error('chaque élément doit être un objet { … }');
  }
  return BSON.EJSON.deserialize(value, {relaxed: false}) as Document;
}

function pushError(errors: ImportIssue[], issue: ImportIssue): void {
  if (errors.length < MAX_ERRORS) {
    errors.push(issue);
  }
}

function lineOfOffset(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
    }
  }
  return line;
}

function parseJson(content: string, maxDocs: number): ParsedImport {
  const errors: ImportIssue[] = [];
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    const match = /position (\d+)/.exec((error as Error).message);
    return {
      documents: [],
      total: 0,
      errors: [
        {
          line: match ? lineOfOffset(content, Number(match[1])) : null,
          message: `JSON invalide : ${(error as Error).message}`,
        },
      ],
    };
  }
  const items = Array.isArray(value) ? value : [value];
  if (items.length > maxDocs) {
    return {
      documents: [],
      total: items.length,
      errors: [
        {line: null, message: `Limite de ${maxDocs} documents dépassée.`},
      ],
    };
  }
  const documents: Document[] = [];
  items.forEach((item, index) => {
    try {
      documents.push(deserialize(item));
    } catch (error) {
      pushError(errors, {
        line: null,
        message: `Élément ${index + 1} : ${(error as Error).message}`,
      });
    }
  });
  return {documents, errors, total: items.length};
}

function parseNdjson(content: string, maxDocs: number): ParsedImport {
  const errors: ImportIssue[] = [];
  const documents: Document[] = [];
  let total = 0;
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      continue;
    }
    total++;
    if (total > maxDocs) {
      return {
        documents: [],
        total,
        errors: [
          {line: null, message: `Limite de ${maxDocs} documents dépassée.`},
        ],
      };
    }
    try {
      documents.push(deserialize(JSON.parse(line)));
    } catch (error) {
      pushError(errors, {line: i + 1, message: (error as Error).message});
    }
  }
  return {documents, errors, total};
}

export function inferCsvValue(field: string, raw: string): unknown {
  if (raw === '') {
    return undefined;
  }
  if (raw === 'true' || raw === 'false') {
    return raw === 'true';
  }
  if (raw === 'null') {
    return null;
  }
  if (/^-?(0|[1-9]\d*)$/.test(raw)) {
    const value = Number(raw);
    if (Number.isSafeInteger(value)) {
      return value >= -(2 ** 31) && value < 2 ** 31
        ? new BSON.Int32(value)
        : BSON.Long.fromString(raw);
    }
    return raw;
  }
  if (/^-?(0|[1-9]\d*)?\.\d+([eE][+-]?\d+)?$/.test(raw)) {
    return new BSON.Double(Number(raw));
  }
  const leaf = field.split('.').pop() ?? field;
  if (HEX_24.test(raw) && (leaf === '_id' || /(Id|_id)$/.test(leaf))) {
    return new BSON.ObjectId(raw);
  }
  if (ISO_DATE.test(raw)) {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  if (
    (raw.startsWith('{') && raw.endsWith('}')) ||
    (raw.startsWith('[') && raw.endsWith(']'))
  ) {
    try {
      return BSON.EJSON.deserialize(JSON.parse(raw) as Document, {
        relaxed: false,
      });
    } catch {
      return raw;
    }
  }
  return raw;
}

function setPath(target: Document, path: string, value: unknown): void {
  const parts = path.split('.');
  let node = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!isPlainObject(node[part])) {
      node[part] = {};
    }
    node = node[part] as Document;
  }
  node[parts[parts.length - 1]] = value;
}

function parseCsv(content: string, maxDocs: number): ParsedImport {
  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
  });
  const errors: ImportIssue[] = [];
  for (const error of result.errors) {
    pushError(errors, {
      line: typeof error.row === 'number' ? error.row + 2 : null,
      message: error.message,
    });
  }
  const headers = result.meta.fields ?? [];
  const unsafe = new Set(['', '__proto__', 'constructor', 'prototype']);
  if (
    headers.some(header => header.split('.').some(part => unsafe.has(part)))
  ) {
    pushError(errors, {
      line: 1,
      message: 'En-tête de colonne invalide ou vide.',
    });
    return {documents: [], errors, total: result.data.length};
  }
  if (result.data.length > maxDocs) {
    return {
      documents: [],
      total: result.data.length,
      errors: [
        {line: null, message: `Limite de ${maxDocs} documents dépassée.`},
      ],
    };
  }
  const documents = result.data.map(row => {
    const document: Document = {};
    for (const header of headers) {
      const value = inferCsvValue(header, row[header] ?? '');
      if (value !== undefined) {
        setPath(document, header, value);
      }
    }
    return document;
  });
  return {documents, errors, total: result.data.length};
}

export function parseImport(
  format: TransferFormat,
  content: string,
  maxDocs: number,
): ParsedImport {
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  switch (format) {
    case 'json':
      return parseJson(text, maxDocs);
    case 'ndjson':
      return parseNdjson(text, maxDocs);
    case 'csv':
      return parseCsv(text, maxDocs);
  }
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function scalarFromWire(value: unknown): unknown {
  if (!isPlainObject(value)) {
    return value;
  }
  if (typeof value.$oid === 'string') {
    return value.$oid;
  }
  if ('$date' in value) {
    const date = value.$date;
    if (typeof date === 'string') {
      return date;
    }
    if (isPlainObject(date) && typeof date.$numberLong === 'string') {
      return new Date(Number(date.$numberLong)).toISOString();
    }
  }
  for (const key of ['$numberLong', '$numberDecimal', '$numberDouble']) {
    if (typeof value[key] === 'string') {
      return value[key];
    }
  }
  return undefined;
}

export function flattenWire(
  value: Record<string, unknown>,
  prefix = '',
  out: Record<string, unknown> = {},
): Record<string, unknown> {
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const scalar = scalarFromWire(item);
    if (scalar !== undefined) {
      out[path] = scalar;
    } else if (
      isPlainObject(item) &&
      !Object.keys(item).some(k => k.startsWith('$'))
    ) {
      flattenWire(item, path, out);
    } else {
      out[path] =
        typeof item === 'object' && item !== null ? JSON.stringify(item) : item;
    }
  }
  return out;
}

export function csvHeader(rows: Record<string, unknown>[]): string[] {
  const headers = new Set<string>();
  for (const row of rows) {
    Object.keys(row).forEach(key => headers.add(key));
  }
  const list = [...headers];
  return list.includes('_id')
    ? ['_id', ...list.filter(key => key !== '_id')]
    : list;
}

export function csvLine(
  headers: string[],
  row: Record<string, unknown>,
): string {
  return headers.map(header => csvCell(row[header])).join(',');
}
