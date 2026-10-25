import {
  type Collection,
  type Document,
  type Filter,
  ObjectId,
  type Sort,
} from 'mongodb';
import {z} from 'zod';
import {badRequest} from './errors.js';
import {assertSafeExpression} from './guard.js';
import {isPlainObject, parseDocumentText} from './mongo-syntax.js';
import {toPlain} from './wire.js';

const MAX_TEXT = 200_000;

export const querySchema = z.object({
  filter: z.string().max(MAX_TEXT).optional(),
  sort: z.string().max(MAX_TEXT).optional(),
  projection: z.string().max(MAX_TEXT).optional(),
  search: z.string().max(200).optional(),
});

export type QueryInput = z.infer<typeof querySchema>;

export interface ResolvedQuery {
  filter: Filter<Document>;
  sort: Sort | undefined;
  projection: Document | undefined;
}

function bsonTypeName(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  if (value instanceof Date) {
    return 'date';
  }
  if (value instanceof RegExp) {
    return 'regex';
  }
  if (typeof value === 'object') {
    const tag = (value as {_bsontype?: string})._bsontype;
    if (tag) {
      return tag.toLowerCase();
    }
    return 'object';
  }
  return typeof value;
}

function normalizeSort(sort: Record<string, unknown>): Sort | undefined {
  const entries = Object.entries(sort);
  if (!entries.length) {
    return undefined;
  }
  const result: Record<string, 1 | -1 | {$meta: string}> = {};
  for (const [key, raw] of entries) {
    const value = toPlain(raw);
    if (value === 1 || value === -1) {
      result[key] = value;
    } else if (isPlainObject(value) && typeof value.$meta === 'string') {
      result[key] = {$meta: value.$meta};
    } else {
      throw badRequest(`Tri : la valeur de « ${key} » doit être 1 ou -1.`);
    }
  }
  return result;
}

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function searchFilter(
  collection: Collection,
  term: string,
): Promise<Document> {
  const clauses: Document[] = [];
  if (/^[0-9a-fA-F]{24}$/.test(term)) {
    clauses.push({_id: new ObjectId(term)});
  }
  const sample = await collection
    .find({}, {limit: 50, maxTimeMS: 3_000})
    .toArray()
    .catch(() => [] as Document[]);
  const stringFields = new Set<string>();
  const numberFields = new Set<string>();
  const visit = (doc: Document, prefix: string, depth: number) => {
    for (const [key, value] of Object.entries(doc)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof value === 'string') {
        stringFields.add(path);
      } else if (typeof value === 'number') {
        numberFields.add(path);
      } else if (depth < 2 && isPlainObject(value)) {
        visit(value, path, depth + 1);
      }
    }
  };
  sample.forEach(doc => visit(doc, '', 0));
  const regex = {$regex: escapeRegex(term), $options: 'i'};
  for (const field of [...stringFields].slice(0, 40)) {
    clauses.push({[field]: regex});
  }
  const numeric = Number(term);
  if (term.trim() !== '' && Number.isFinite(numeric)) {
    for (const field of [...numberFields].slice(0, 20)) {
      clauses.push({[field]: numeric});
    }
  }
  return clauses.length ? {$or: clauses} : {_id: {$exists: false}};
}

export async function resolveQuery(
  collection: Collection,
  input: QueryInput,
): Promise<ResolvedQuery> {
  let filter: Document = parseDocumentText(input.filter, 'Filtre');
  const sort = parseDocumentText(input.sort, 'Tri');
  const projection = parseDocumentText(input.projection, 'Projection');
  assertSafeExpression(filter, 'Filtre');
  assertSafeExpression(projection, 'Projection');
  const term = input.search?.trim();
  if (term) {
    const search = await searchFilter(collection, term);
    filter = Object.keys(filter).length ? {$and: [filter, search]} : search;
  }
  return {
    filter,
    sort: normalizeSort(sort),
    projection: Object.keys(projection).length ? projection : undefined,
  };
}

export interface FieldInfo {
  path: string;
  types: string[];
  frequency: number;
}

export function analyzeFields(
  documents: Document[],
  maxDepth = 3,
): FieldInfo[] {
  const fields = new Map<string, {types: Set<string>; count: number}>();
  const visit = (value: Document, prefix: string, depth: number) => {
    for (const [key, item] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const entry = fields.get(path) ?? {types: new Set<string>(), count: 0};
      entry.types.add(bsonTypeName(item));
      entry.count++;
      fields.set(path, entry);
      if (depth < maxDepth && isPlainObject(item)) {
        visit(item, path, depth + 1);
      }
    }
  };
  documents.forEach(doc => visit(doc, '', 1));
  const total = Math.max(documents.length, 1);
  return [...fields.entries()]
    .map(([path, entry]) => ({
      path,
      types: [...entry.types].sort(),
      frequency: Math.round((entry.count / total) * 1000) / 1000,
    }))
    .sort((a, b) =>
      a.path === '_id'
        ? -1
        : b.path === '_id'
          ? 1
          : b.frequency - a.frequency || a.path.localeCompare(b.path),
    );
}
