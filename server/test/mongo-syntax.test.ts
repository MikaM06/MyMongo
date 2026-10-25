import {BSON, ObjectId} from 'mongodb';
import {describe, expect, it} from 'vitest';
import {
  parseDocumentText,
  parseExtendedJson,
  parseMongoValue,
  parsePipelineText,
  SyntaxParseError,
} from '../src/lib/mongo-syntax.js';

describe('parseExtendedJson', () => {
  it('parses strict JSON', () => {
    expect(
      parseExtendedJson('{"status": "active", "age": {"$gte": 18}}'),
    ).toEqual({status: 'active', age: {$gte: 18}});
  });

  it('accepts unquoted keys, single quotes, comments and trailing commas', () => {
    const text = `{
      // filtre
      status: 'active', /* bloc */
      "nested.path": [1, 2,],
    }`;
    expect(parseExtendedJson(text)).toEqual({
      status: 'active',
      'nested.path': [1, 2],
    });
  });

  it('keeps large integers exact', () => {
    expect(parseExtendedJson('{"n": 9007199254740993}')).toEqual({
      n: {$numberLong: '9007199254740993'},
    });
  });

  it('marks integral decimals as doubles', () => {
    expect(parseExtendedJson('{"n": 5.0}')).toEqual({
      n: {$numberDouble: '5.0'},
    });
  });

  it('reports line and column of errors', () => {
    try {
      parseExtendedJson('{\n  "a": 1\n  "b": 2\n}');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SyntaxParseError);
      expect((error as SyntaxParseError).line).toBe(3);
      expect((error as SyntaxParseError).message).toContain('Ligne 3');
    }
  });

  it('rejects duplicate keys and __proto__', () => {
    expect(() => parseExtendedJson('{"a": 1, "a": 2}')).toThrow(/dupliquée/);
    expect(() => parseExtendedJson('{"__proto__": {"x": 1}}')).toThrow(
      /interdite/,
    );
  });

  it('never evaluates code', () => {
    expect(() => parseExtendedJson('{"a": process.exit(1)}')).toThrow(
      SyntaxParseError,
    );
    expect(() => parseExtendedJson('{"a": function() {}}')).toThrow(
      SyntaxParseError,
    );
    expect(() => parseExtendedJson('this.constructor')).toThrow(
      SyntaxParseError,
    );
  });

  it('limits nesting depth', () => {
    const deep = '['.repeat(200) + ']'.repeat(200);
    expect(() => parseExtendedJson(deep)).toThrow(/profonde/);
  });
});

describe('parseMongoValue', () => {
  it('builds BSON types from shell helpers', () => {
    const value = parseMongoValue(`{
      _id: ObjectId("64b7f0c2a1b2c3d4e5f60718"),
      at: ISODate("2024-01-02T03:04:05.000Z"),
      big: NumberLong("123456789012"),
      small: NumberInt(7),
      price: NumberDecimal("19.99"),
      ratio: 0.5,
      whole: Double(3),
      name: /^ali/i
    }`) as Record<string, unknown>;
    expect(value._id).toBeInstanceOf(ObjectId);
    expect((value._id as ObjectId).toHexString()).toBe(
      '64b7f0c2a1b2c3d4e5f60718',
    );
    expect(value.at).toBeInstanceOf(Date);
    expect((value.at as Date).toISOString()).toBe('2024-01-02T03:04:05.000Z');
    expect(value.big).toBeInstanceOf(BSON.Long);
    expect(value.small).toBeInstanceOf(BSON.Int32);
    expect(value.price).toBeInstanceOf(BSON.Decimal128);
    expect(value.ratio).toBeInstanceOf(BSON.Double);
    expect(value.whole).toBeInstanceOf(BSON.Double);
    expect(value.name).toBeInstanceOf(BSON.BSONRegExp);
  });

  it('supports canonical extended JSON', () => {
    const value = parseMongoValue(
      '{"_id": {"$oid": "64b7f0c2a1b2c3d4e5f60718"}, "n": {"$numberLong": "5"}}',
    ) as Record<string, unknown>;
    expect(value._id).toBeInstanceOf(ObjectId);
    expect(value.n).toBeInstanceOf(BSON.Long);
  });

  it('rejects invalid helpers', () => {
    expect(() => parseMongoValue('ObjectId("nope")')).toThrow(/24 caractères/);
    expect(() => parseMongoValue('ISODate("pas une date")')).toThrow(/date/);
    expect(() => parseMongoValue('Eval("1")')).toThrow(/non prise en charge/);
  });
});

describe('document and pipeline helpers', () => {
  it('returns an empty filter for blank text', () => {
    expect(parseDocumentText('  ', 'Filtre')).toEqual({});
  });

  it('requires an object', () => {
    expect(() => parseDocumentText('[1]', 'Filtre')).toThrow(/objet/);
  });

  it('wraps a single stage into a pipeline', () => {
    expect(parsePipelineText('{"$match": {}}')).toHaveLength(1);
    expect(() => parsePipelineText('[1, 2]')).toThrow(/tableau/);
  });
});
