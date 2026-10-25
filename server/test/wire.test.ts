import {BSON, ObjectId} from 'mongodb';
import {describe, expect, it} from 'vitest';
import {parseMongoValue} from '../src/lib/mongo-syntax.js';
import {fromWire, toWire} from '../src/lib/wire.js';

describe('toWire', () => {
  const document = {
    _id: new ObjectId('64b7f0c2a1b2c3d4e5f60718'),
    int: new BSON.Int32(42),
    double: new BSON.Double(5),
    fraction: new BSON.Double(2.5),
    long: BSON.Long.fromString('9007199254740993'),
    decimal: BSON.Decimal128.fromString('1.10'),
    date: new Date('2024-05-01T00:00:00.000Z'),
    uuid: new BSON.UUID('0f8fad5b-d9cb-469f-a165-70867728950e'),
    nested: {list: [new BSON.Int32(1), 'two', null, true]},
  };

  it('preserves every BSON type in a readable form', () => {
    expect(toWire(document)).toEqual({
      _id: {$oid: '64b7f0c2a1b2c3d4e5f60718'},
      int: 42,
      double: {$numberDouble: '5.0'},
      fraction: 2.5,
      long: {$numberLong: '9007199254740993'},
      decimal: {$numberDecimal: '1.10'},
      date: {$date: '2024-05-01T00:00:00.000Z'},
      uuid: {$binary: {base64: 'D4+tW9nLRp+hZXCGdyiVDg==', subType: '04'}},
      nested: {list: [1, 'two', null, true]},
    });
  });

  it('round-trips through the editor text without changing types', () => {
    const text = JSON.stringify(toWire(document), null, 2);
    const parsed = parseMongoValue(text) as Record<string, unknown>;
    expect(parsed.int).toBeInstanceOf(BSON.Int32);
    expect(parsed.double).toBeInstanceOf(BSON.Double);
    expect(parsed.fraction).toBeInstanceOf(BSON.Double);
    expect(parsed.long).toBeInstanceOf(BSON.Long);
    expect((parsed.long as BSON.Long).toString()).toBe('9007199254740993');
    expect(parsed.decimal).toBeInstanceOf(BSON.Decimal128);
    expect(parsed.date).toBeInstanceOf(Date);
    expect(parsed._id).toBeInstanceOf(ObjectId);
    expect(BSON.serialize(parsed)).toEqual(BSON.serialize(document));
  });

  it('keeps special doubles', () => {
    expect(toWire(new BSON.Double(-0))).toEqual({$numberDouble: '-0.0'});
    expect(toWire(new BSON.Double(Infinity))).toEqual({
      $numberDouble: 'Infinity',
    });
    expect(fromWire({$numberDouble: 'NaN'})).toBeInstanceOf(BSON.Double);
  });
});
