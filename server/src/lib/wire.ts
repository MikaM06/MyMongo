import {BSON} from 'mongodb';
import {isPlainObject} from './mongo-syntax.js';

interface BsonValue {
  _bsontype: string;
  valueOf(): unknown;
  toString(): string;
}

function isBsonValue(value: unknown): value is BsonValue {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as {_bsontype?: unknown})._bsontype === 'string'
  );
}

function formatDouble(value: number): string {
  if (Object.is(value, -0)) {
    return '-0.0';
  }
  if (Number.isInteger(value) && Math.abs(value) < 1e21) {
    return value.toFixed(1);
  }
  return String(value);
}

function doubleToWire(value: number): unknown {
  if (Number.isInteger(value) || !Number.isFinite(value)) {
    return {$numberDouble: formatDouble(value)};
  }
  return value;
}

export function toWire(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : doubleToWire(value);
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') {
    return {$numberLong: value.toString()};
  }
  if (Array.isArray(value)) {
    return value.map(toWire);
  }
  if (isBsonValue(value)) {
    switch (value._bsontype) {
      case 'Double':
        return doubleToWire(value.valueOf() as number);
      case 'Int32':
        return value.valueOf();
      case 'Long':
        return {$numberLong: value.toString()};
      default:
        return BSON.EJSON.serialize(value, {relaxed: true});
    }
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return time >= 0 && time < 253402300800000
      ? {$date: value.toISOString()}
      : {$date: {$numberLong: String(time)}};
  }
  if (value instanceof RegExp) {
    return BSON.EJSON.serialize(value, {relaxed: true});
  }
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) {
        result[key] = toWire(item);
      }
    }
    return result;
  }
  return BSON.EJSON.serialize(value as BSON.Document, {relaxed: true});
}

export function fromWire(value: unknown): unknown {
  return BSON.EJSON.deserialize(value as BSON.Document, {relaxed: false});
}

export function toPlain(value: unknown): unknown {
  if (isBsonValue(value)) {
    switch (value._bsontype) {
      case 'Double':
      case 'Int32':
        return value.valueOf();
      case 'Long':
        return Number(value.toString());
      default:
        return value;
    }
  }
  if (Array.isArray(value)) {
    return value.map(toPlain);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toPlain(item)]),
    );
  }
  return value;
}
