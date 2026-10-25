import {describe, expect, it} from 'vitest';
import {
  hashPassword,
  validatePasswordStrength,
  verifyPassword,
} from '../src/auth/password.js';
import {FailureLimiter} from '../src/auth/rate-limit.js';
import {SessionStore} from '../src/auth/sessions.js';
import {loadConfig, loadConnections} from '../src/config.js';
import {HttpError} from '../src/lib/errors.js';
import {assertSafeExpression, assertSafePipeline} from '../src/lib/guard.js';
import {collectionName, databaseName} from '../src/lib/names.js';
import {extractHosts} from '../src/mongo/registry.js';

describe('passwords', () => {
  it('hashes with a random salt and verifies', async () => {
    const first = await hashPassword('Correct-Horse-42');
    const second = await hashPassword('Correct-Horse-42');
    expect(first).not.toBe(second);
    expect(first).not.toContain('Correct-Horse-42');
    expect(await verifyPassword('Correct-Horse-42', first)).toBe(true);
    expect(await verifyPassword('correct-horse-42', first)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });

  it('enforces a minimal policy', () => {
    expect(validatePasswordStrength('short')).toMatch(/12/);
    expect(validatePasswordStrength('alllowercaseletters')).toMatch(/trois/);
    expect(validatePasswordStrength('Strong-Enough-1')).toBeNull();
  });
});

describe('FailureLimiter', () => {
  it('locks after too many failures then releases', () => {
    let now = 0;
    const limiter = new FailureLimiter({
      maxFailures: 3,
      windowMs: 1_000,
      now: () => now,
    });
    limiter.fail('a');
    limiter.fail('a');
    expect(limiter.retryAfterSeconds('a')).toBe(0);
    limiter.fail('a');
    expect(limiter.retryAfterSeconds('a')).toBe(1);
    expect(limiter.retryAfterSeconds('b')).toBe(0);
    now = 1_000;
    expect(limiter.retryAfterSeconds('a')).toBe(0);
  });
});

describe('SessionStore', () => {
  it('expires idle and old sessions', () => {
    let now = 0;
    const store = new SessionStore({ttlMs: 100, idleMs: 30, now: () => now});
    const session = store.create('alice', 'admin', 'stamp', '127.0.0.1');
    expect(session.id).toHaveLength(43);
    now = 20;
    expect(store.get(session.id)).toBeDefined();
    now = 60;
    expect(store.get(session.id)).toBeUndefined();
    const other = store.create('bob', 'readonly', 'stamp', '127.0.0.1');
    for (now = 70; now <= 160; now += 20) {
      store.get(other.id);
    }
    expect(store.get(other.id)).toBeUndefined();
  });
});

describe('guards', () => {
  it('blocks server-side JavaScript operators', () => {
    expect(() =>
      assertSafeExpression({$where: 'sleep(1000)'}, 'Filtre'),
    ).toThrow(HttpError);
    expect(() =>
      assertSafeExpression({a: {$expr: {$function: {}}}}, 'Filtre'),
    ).toThrow(/JavaScript/);
    expect(() =>
      assertSafePipeline([{$group: {_id: null, x: {$accumulator: {}}}}], true),
    ).toThrow(/JavaScript/);
  });

  it('reserves write stages to admins and checks their position', () => {
    expect(() => assertSafePipeline([{$out: 'copy'}], false)).toThrow(
      /administrateur/,
    );
    expect(() =>
      assertSafePipeline([{$out: 'copy'}, {$match: {}}], true),
    ).toThrow(/dernière/);
    expect(() => assertSafePipeline([{$match: {}, $limit: 1}], true)).toThrow(
      /exactement un/,
    );
    expect(() =>
      assertSafePipeline([{$match: {}}, {$out: 'x'}], true),
    ).not.toThrow();
  });
});

describe('names', () => {
  it('validates database and collection names', () => {
    expect(databaseName.safeParse('shop').success).toBe(true);
    expect(databaseName.safeParse('my.db').success).toBe(false);
    expect(databaseName.safeParse('a/b').success).toBe(false);
    expect(collectionName.safeParse('orders.archive').success).toBe(true);
    expect(collectionName.safeParse('bad$name').success).toBe(false);
  });
});

describe('configuration', () => {
  it('loads connections without exposing credentials', () => {
    const connections = loadConnections({
      MONGODB_URI: 'mongodb://user:secret@db:27017/?authSource=admin',
      MYMONGO_CONNECTION_ANALYTICS_URI: 'mongodb+srv://u:p@cluster.example.net',
      MYMONGO_CONNECTION_ANALYTICS_LABEL: 'Analytics',
    });
    expect(connections.map(item => item.id)).toEqual(['default', 'analytics']);
    expect(extractHosts(connections[0].uri)).toEqual(['db:27017']);
    expect(extractHosts('mongodb://a:1,b:2/db')).toEqual(['a:1', 'b:2']);
  });

  it('rejects invalid URIs and has no default credentials', () => {
    expect(() => loadConnections({MONGODB_URI: 'http://evil'})).toThrow();
    const config = loadConfig({NODE_ENV: 'production'});
    expect(config.connections).toEqual([]);
    expect(config.secureCookies).toBe(true);
    expect(config.host).toBe('127.0.0.1');
  });
});
