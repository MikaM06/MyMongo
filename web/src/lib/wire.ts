export type WireValue =
  null | boolean | number | string | WireValue[] | {[key: string]: WireValue};

export type WireDocument = {[key: string]: WireValue};

export type BsonKind =
  | 'string'
  | 'int'
  | 'double'
  | 'long'
  | 'decimal'
  | 'bool'
  | 'null'
  | 'objectId'
  | 'date'
  | 'uuid'
  | 'binary'
  | 'regex'
  | 'timestamp'
  | 'minKey'
  | 'maxKey'
  | 'code'
  | 'symbol'
  | 'dbRef'
  | 'array'
  | 'object';

export interface Classified {
  kind: BsonKind;
  text: string;
}

export function isRecord(value: unknown): value is {[key: string]: WireValue} {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function base64ToHex(base64: string): string {
  try {
    return Array.from(atob(base64), char =>
      char.charCodeAt(0).toString(16).padStart(2, '0'),
    ).join('');
  } catch {
    return '';
  }
}

function uuidFromBase64(base64: string): string {
  const hex = base64ToHex(base64);
  return hex.length === 32
    ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    : base64;
}

export function classify(value: WireValue): Classified {
  if (value === null) {
    return {kind: 'null', text: 'null'};
  }
  if (typeof value === 'string') {
    return {kind: 'string', text: value};
  }
  if (typeof value === 'boolean') {
    return {kind: 'bool', text: String(value)};
  }
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? {kind: 'int', text: String(value)}
      : {kind: 'double', text: String(value)};
  }
  if (Array.isArray(value)) {
    return {kind: 'array', text: `Array(${value.length})`};
  }
  const keys = Object.keys(value);
  if (keys.length === 1 || (keys.length === 2 && '$ref' in value)) {
    const [key] = keys;
    const inner = value[key];
    switch (key) {
      case '$oid':
        return {kind: 'objectId', text: String(inner)};
      case '$date':
        if (typeof inner === 'string') {
          return {kind: 'date', text: inner};
        }
        if (isRecord(inner) && typeof inner.$numberLong === 'string') {
          const date = new Date(Number(inner.$numberLong));
          return {
            kind: 'date',
            text: Number.isNaN(date.getTime())
              ? inner.$numberLong
              : date.toISOString(),
          };
        }
        break;
      case '$numberLong':
        return {kind: 'long', text: String(inner)};
      case '$numberDecimal':
        return {kind: 'decimal', text: String(inner)};
      case '$numberDouble':
        return {kind: 'double', text: String(inner)};
      case '$numberInt':
        return {kind: 'int', text: String(inner)};
      case '$binary':
        if (isRecord(inner) && typeof inner.base64 === 'string') {
          return inner.subType === '04' || inner.subType === '4'
            ? {kind: 'uuid', text: uuidFromBase64(inner.base64)}
            : {
                kind: 'binary',
                text: `Binary(${String(inner.subType)}, ${inner.base64.slice(0, 24)}${inner.base64.length > 24 ? '…' : ''})`,
              };
        }
        break;
      case '$uuid':
        return {kind: 'uuid', text: String(inner)};
      case '$regularExpression':
        if (isRecord(inner)) {
          return {
            kind: 'regex',
            text: `/${String(inner.pattern)}/${String(inner.options ?? '')}`,
          };
        }
        break;
      case '$timestamp':
        if (isRecord(inner)) {
          return {
            kind: 'timestamp',
            text: `Timestamp(${String(inner.t)}, ${String(inner.i)})`,
          };
        }
        break;
      case '$minKey':
        return {kind: 'minKey', text: 'MinKey'};
      case '$maxKey':
        return {kind: 'maxKey', text: 'MaxKey'};
      case '$code':
        return {kind: 'code', text: String(inner)};
      case '$symbol':
        return {kind: 'symbol', text: String(inner)};
      default:
        break;
    }
  }
  if ('$ref' in value && '$id' in value) {
    return {kind: 'dbRef', text: `DBRef(${String(value.$ref)})`};
  }
  if (keys.length === 2 && '$code' in value && '$scope' in value) {
    return {kind: 'code', text: String(value.$code)};
  }
  return {
    kind: 'object',
    text: `{${keys.length} champ${keys.length > 1 ? 's' : ''}}`,
  };
}

export const KIND_LABEL: Record<BsonKind, string> = {
  string: 'String',
  int: 'Int32',
  double: 'Double',
  long: 'Int64',
  decimal: 'Decimal128',
  bool: 'Boolean',
  null: 'Null',
  objectId: 'ObjectId',
  date: 'Date',
  uuid: 'UUID',
  binary: 'Binary',
  regex: 'RegExp',
  timestamp: 'Timestamp',
  minKey: 'MinKey',
  maxKey: 'MaxKey',
  code: 'Code',
  symbol: 'Symbol',
  dbRef: 'DBRef',
  array: 'Array',
  object: 'Object',
};

export function isContainer(value: WireValue): boolean {
  const kind = classify(value).kind;
  return kind === 'array' || kind === 'object';
}

export function idToText(id: WireValue | undefined): string {
  return JSON.stringify(id ?? null);
}

export function shellLiteral(value: WireValue): string {
  const {kind, text} = classify(value);
  switch (kind) {
    case 'objectId':
      return `ObjectId("${text}")`;
    case 'date':
      return `ISODate("${text}")`;
    case 'uuid':
      return `UUID("${text}")`;
    case 'long':
      return `NumberLong("${text}")`;
    case 'decimal':
      return `NumberDecimal("${text}")`;
    case 'string':
      return JSON.stringify(text);
    default:
      return JSON.stringify(value);
  }
}

export function idDisplay(id: WireValue | undefined): string {
  if (id === undefined) {
    return '—';
  }
  const {kind, text} = classify(id);
  return kind === 'object' || kind === 'array' ? JSON.stringify(id) : text;
}

export function documentColumns(documents: WireDocument[], max = 12): string[] {
  const counts = new Map<string, number>();
  for (const document of documents) {
    for (const key of Object.keys(document)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const keys = [...counts.entries()]
    .filter(([key]) => key !== '_id')
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);
  return (counts.has('_id') ? ['_id', ...keys] : keys).slice(0, max);
}

export function stripId(document: WireDocument): WireDocument {
  const copy = {...document};
  delete copy._id;
  return copy;
}

export function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
