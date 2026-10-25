import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {FastifyInstance} from 'fastify';
import {BSON, MongoClient} from 'mongodb';
import {MongoMemoryServer} from 'mongodb-memory-server';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {type AppContext, buildApp} from '../src/app.js';
import {loadConfig} from '../src/config.js';

const ADMIN_PASSWORD = 'Admin-Password-123';
const READER_PASSWORD = 'Reader-Password-123';

interface Agent {
  cookie: string;
  csrf: string;
}

let mongo: MongoMemoryServer;
let client: MongoClient;
let app: FastifyInstance;
let context: AppContext;
let dataDir: string;
let admin: Agent;
let reader: Agent;

const base = '/api/conn/default/databases/shop/collections/orders';

async function login(username: string, password: string): Promise<Agent> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: {username, password},
  });
  expect(response.statusCode).toBe(200);
  const cookie = String(response.headers['set-cookie']).split(';')[0];
  return {cookie, csrf: response.json().csrfToken};
}

function call(
  agent: Agent | null,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
) {
  return app.inject({
    method,
    url,
    payload: payload as Record<string, unknown> | undefined,
    headers: agent ? {cookie: agent.cookie, 'x-csrf-token': agent.csrf} : {},
  });
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongo.getUri());
  dataDir = await mkdtemp(path.join(tmpdir(), 'mymongo-test-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    MONGODB_URI: mongo.getUri(),
    MYMONGO_DATA_DIR: dataDir,
    MYMONGO_WEB_DIR: path.join(dataDir, 'web'),
    MYMONGO_LOG_LEVEL: 'silent',
  });
  ({app, context} = await buildApp(config));
  await context.users.create('admin', ADMIN_PASSWORD, 'admin');
  await context.users.create('reader', READER_PASSWORD, 'readonly');
  admin = await login('admin', ADMIN_PASSWORD);
  reader = await login('reader', READER_PASSWORD);
  await client
    .db('shop')
    .collection('orders')
    .insertMany([
      {
        status: 'active',
        total: new BSON.Double(10),
        qty: 1,
        createdAt: new Date('2024-01-01T00:00:00Z'),
      },
      {status: 'active', total: 25.5, qty: 3},
      {
        status: 'closed',
        total: 99.9,
        qty: 2,
        ref: BSON.Long.fromString('9007199254740993'),
      },
    ]);
});

afterAll(async () => {
  await app?.close();
  await client?.close();
  await mongo?.stop();
  if (dataDir) {
    await rm(dataDir, {recursive: true, force: true});
  }
});

describe('authentication', () => {
  it('keeps the health endpoint public', async () => {
    const response = await call(null, 'GET', '/api/health');
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ok');
  });

  it('rejects anonymous access', async () => {
    const response = await call(null, 'GET', '/api/connections');
    expect(response.statusCode).toBe(401);
  });

  it('sets a hardened session cookie', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {username: 'admin', password: ADMIN_PASSWORD},
    });
    const cookie = String(response.headers['set-cookie']);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(response.body).not.toContain(mongo.getUri());
  });

  it('rejects bad credentials with a generic message and locks out', async () => {
    for (let i = 0; i < 5; i++) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {username: 'ghost', password: 'nope'},
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.message).toBe(
        'Identifiant ou mot de passe incorrect.',
      );
    }
    const locked = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {username: 'ghost', password: 'nope'},
    });
    expect(locked.statusCode).toBe(429);
    expect(locked.headers['retry-after']).toBeDefined();
  });

  it('requires the CSRF token on mutations', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `${base}/find`,
      payload: {},
      headers: {cookie: admin.cookie},
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects cross-origin mutations', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `${base}/find`,
      payload: {},
      headers: {
        cookie: admin.cookie,
        'x-csrf-token': admin.csrf,
        origin: 'https://evil.example',
      },
    });
    expect(response.statusCode).toBe(403);
  });

  it('never returns connection credentials', async () => {
    const response = await call(admin, 'GET', '/api/connections');
    expect(response.statusCode).toBe(200);
    expect(response.json().connections[0]).toEqual({
      id: 'default',
      label: 'MongoDB',
      hosts: [expect.stringContaining('127.0.0.1')],
    });
  });
});

describe('explorer', () => {
  it('returns a real overview', async () => {
    const response = await call(admin, 'GET', '/api/conn/default/overview');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.server.version).toMatch(/^\d+\.\d+/);
    expect(body.totals.databases).toBeGreaterThan(0);
  });

  it('lists databases and collections with stats', async () => {
    const dbs = await call(admin, 'GET', '/api/conn/default/databases');
    expect(dbs.json().databases.map((db: {name: string}) => db.name)).toContain(
      'shop',
    );
    const colls = await call(
      admin,
      'GET',
      '/api/conn/default/databases/shop/collections',
    );
    const orders = colls
      .json()
      .collections.find((item: {name: string}) => item.name === 'orders');
    expect(orders.stats.count).toBe(3);
  });

  it('filters, sorts, projects and paginates on the server', async () => {
    const response = await call(admin, 'POST', `${base}/find`, {
      filter: '{status: "active", qty: {$gte: 1}}',
      sort: '{qty: -1}',
      projection: '{status: 1, qty: 1}',
      limit: 1,
      skip: 0,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBe(2);
    expect(body.totalExact).toBe(true);
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0].qty).toBe(3);
    expect(Object.keys(body.documents[0]).sort()).toEqual([
      '_id',
      'qty',
      'status',
    ]);
    expect(typeof body.durationMs).toBe('number');
  });

  it('preserves BSON types in responses', async () => {
    const response = await call(admin, 'POST', `${base}/find`, {
      filter: '{status: "closed"}',
    });
    const [doc] = response.json().documents;
    expect(doc._id.$oid).toMatch(/^[0-9a-f]{24}$/);
    expect(doc.ref).toEqual({$numberLong: '9007199254740993'});
    const first = await call(admin, 'POST', `${base}/find`, {
      filter: '{total: 10}',
    });
    expect(first.json().documents[0].total).toEqual({$numberDouble: '10.0'});
    expect(first.json().documents[0].createdAt).toEqual({
      $date: '2024-01-01T00:00:00.000Z',
    });
  });

  it('searches across string fields', async () => {
    const response = await call(admin, 'POST', `${base}/find`, {
      search: 'clos',
    });
    expect(response.json().documents).toHaveLength(1);
  });

  it('explains syntax errors clearly', async () => {
    const response = await call(admin, 'POST', `${base}/find`, {
      filter: '{status: "active",, }',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/Filtre — /);
    expect(response.json().error.details.line).toBe(1);
  });

  it('refuses $where', async () => {
    const response = await call(admin, 'POST', `${base}/find`, {
      filter: '{$where: "this.qty > 1"}',
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('documents', () => {
  let insertedId: string;

  it('inserts with BSON helpers', async () => {
    const response = await call(admin, 'POST', `${base}/documents`, {
      document:
        '{status: "new", qty: NumberInt(4), at: ISODate("2025-02-03T00:00:00Z"), price: NumberDecimal("4.20")}',
    });
    expect(response.statusCode).toBe(200);
    insertedId = JSON.stringify(response.json().insertedId);
    const stored = await client
      .db('shop')
      .collection('orders')
      .findOne({status: 'new'}, {promoteValues: false});
    expect(stored?.qty).toBeInstanceOf(BSON.Int32);
    expect(stored?.at).toBeInstanceOf(Date);
    expect(stored?.price).toBeInstanceOf(BSON.Decimal128);
  });

  it('replaces a document without changing untouched types', async () => {
    const fetched = await call(admin, 'POST', `${base}/document`, {
      id: insertedId,
    });
    const document = fetched.json().document;
    document.status = 'edited';
    const response = await call(admin, 'PUT', `${base}/documents`, {
      id: insertedId,
      document: JSON.stringify(document),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().modified).toBe(1);
    const stored = await client
      .db('shop')
      .collection('orders')
      .findOne({status: 'edited'}, {promoteValues: false});
    expect(stored?.qty).toBeInstanceOf(BSON.Int32);
    expect(stored?.price).toBeInstanceOf(BSON.Decimal128);
  });

  it('refuses to change _id on replace', async () => {
    const response = await call(admin, 'PUT', `${base}/documents`, {
      id: insertedId,
      document: '{_id: ObjectId("000000000000000000000000"), status: "x"}',
    });
    expect(response.statusCode).toBe(400);
  });

  it('blocks writes for read-only users', async () => {
    const insert = await call(reader, 'POST', `${base}/documents`, {
      document: '{a: 1}',
    });
    expect(insert.statusCode).toBe(403);
    const drop = await call(reader, 'DELETE', `${base}/documents`, {
      id: insertedId,
    });
    expect(drop.statusCode).toBe(403);
    const read = await call(reader, 'POST', `${base}/find`, {});
    expect(read.statusCode).toBe(200);
    const out = await call(reader, 'POST', `${base}/aggregate`, {
      pipeline: '[{$out: "stolen"}]',
    });
    expect(out.statusCode).toBe(403);
  });

  it('deletes a document', async () => {
    const response = await call(admin, 'DELETE', `${base}/documents`, {
      id: insertedId,
    });
    expect(response.statusCode).toBe(200);
  });

  it('requires the collection name to delete many', async () => {
    const wrong = await call(admin, 'POST', `${base}/delete-many`, {
      filter: '{}',
      confirm: 'yes',
    });
    expect(wrong.statusCode).toBe(400);
  });
});

describe('aggregation', () => {
  it('runs a pipeline and truncates results', async () => {
    const response = await call(admin, 'POST', `${base}/aggregate`, {
      pipeline: '[{$group: {_id: "$status", n: {$sum: 1}}}, {$sort: {_id: 1}}]',
      limit: 1,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.documents).toEqual([{_id: 'active', n: 2}]);
    expect(body.truncated).toBe(true);
  });

  it('surfaces MongoDB errors', async () => {
    const response = await call(admin, 'POST', `${base}/aggregate`, {
      pipeline: '[{$nope: {}}]',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/nope/i);
  });
});

describe('indexes', () => {
  it('creates, lists and drops an index', async () => {
    const created = await call(admin, 'POST', `${base}/indexes`, {
      keys: [
        {field: 'status', type: '1'},
        {field: 'qty', type: '-1'},
      ],
      name: 'status_qty',
    });
    expect(created.statusCode).toBe(200);
    const list = await call(admin, 'GET', `${base}/indexes`);
    const names = list
      .json()
      .indexes.map((index: {name: string}) => index.name);
    expect(names).toEqual(['_id_', 'status_qty']);
    const dropped = await call(admin, 'DELETE', `${base}/indexes/status_qty`);
    expect(dropped.statusCode).toBe(200);
  });

  it('never drops the _id_ index', async () => {
    const response = await call(admin, 'DELETE', `${base}/indexes/_id_`);
    expect(response.statusCode).toBe(403);
  });

  it('reports unique index conflicts', async () => {
    const response = await call(admin, 'POST', `${base}/indexes`, {
      keys: [{field: 'status', type: '1'}],
      unique: true,
    });
    expect(response.statusCode).toBe(409);
  });
});

describe('import and export', () => {
  const target = '/api/conn/default/databases/shop/collections/imported';

  it('previews and imports NDJSON with types', async () => {
    const content = [
      '{"_id": {"$oid": "64b7f0c2a1b2c3d4e5f60718"}, "n": {"$numberLong": "5"}}',
      '{"name": "b", "at": {"$date": "2024-01-01T00:00:00Z"}}',
    ].join('\n');
    const preview = await call(admin, 'POST', `${target}/import/preview`, {
      format: 'ndjson',
      content,
    });
    expect(preview.json()).toMatchObject({total: 2, valid: 2, withId: 1});
    const run = await call(admin, 'POST', `${target}/import`, {
      format: 'ndjson',
      content,
    });
    expect(run.json()).toMatchObject({inserted: 2, failed: 0});
    const again = await call(admin, 'POST', `${target}/import`, {
      format: 'ndjson',
      content,
      mode: 'insert',
    });
    expect(again.json()).toMatchObject({inserted: 1, failed: 1});
    const stored = await client
      .db('shop')
      .collection('imported')
      .findOne({}, {promoteValues: false});
    expect(stored?.n).toBeInstanceOf(BSON.Long);
  });

  it('reports invalid lines without importing', async () => {
    const response = await call(admin, 'POST', `${target}/import`, {
      format: 'ndjson',
      content: '{"ok": 1}\n{oops}',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.details.errors[0].line).toBe(2);
  });

  it('imports CSV with inferred types', async () => {
    const response = await call(admin, 'POST', `${target}/import`, {
      format: 'csv',
      content: 'name,address.city,age,active\nZoé,Paris,31,true\n',
    });
    expect(response.json().inserted).toBe(1);
    const stored = await client
      .db('shop')
      .collection('imported')
      .findOne({name: 'Zoé'});
    expect(stored).toMatchObject({
      address: {city: 'Paris'},
      age: 31,
      active: true,
    });
  });

  it('exports filtered documents', async () => {
    const json = await call(admin, 'POST', `${base}/export`, {
      format: 'json',
      filter: '{status: "active"}',
    });
    expect(json.statusCode).toBe(200);
    expect(json.headers['content-disposition']).toContain('shop.orders.json');
    expect(JSON.parse(json.body)).toHaveLength(2);
    const csv = await call(admin, 'POST', `${base}/export`, {format: 'csv'});
    const lines = csv.body.trim().split('\n');
    expect(lines[0].startsWith('_id,')).toBe(true);
    expect(lines).toHaveLength(4);
  });
});

describe('collections', () => {
  const colls = '/api/conn/default/databases/shop/collections';

  it('creates a capped collection, renames and drops it', async () => {
    const created = await call(admin, 'POST', colls, {
      name: 'logs',
      capped: true,
      size: 1_048_576,
    });
    expect(created.statusCode).toBe(200);
    const renamed = await call(admin, 'PATCH', `${colls}/logs`, {
      name: 'events',
    });
    expect(renamed.statusCode).toBe(200);
    const list = await call(admin, 'GET', `${colls}?stats=0`);
    const events = list
      .json()
      .collections.find((item: {name: string}) => item.name === 'events');
    expect(events.capped).toBe(true);
    const dropped = await call(admin, 'DELETE', `${colls}/events`, {
      confirm: 'events',
    });
    expect(dropped.statusCode).toBe(200);
  });

  it('creates a database with its first collection', async () => {
    const response = await call(admin, 'POST', '/api/conn/default/databases', {
      name: 'crm',
      collection: 'contacts',
    });
    expect(response.statusCode).toBe(200);
    const names = await client.db('crm').listCollections().toArray();
    expect(names.map(item => item.name)).toEqual(['contacts']);
  });
});

describe('mongodb users', () => {
  const users = '/api/conn/default/mongo-users';

  it('creates a user together with its own database', async () => {
    const response = await call(admin, 'POST', users, {
      username: 'app_crm',
      password: 'Crm-Password-2026!',
      authDatabase: 'admin',
      roles: [{role: 'dbOwner', db: 'crm_app'}],
      createDatabase: {name: 'crm_app', collection: 'contacts'},
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({databaseCreated: true});
    const collections = await client.db('crm_app').listCollections().toArray();
    expect(collections.map(item => item.name)).toEqual(['contacts']);
    const info = await client
      .db('admin')
      .command({usersInfo: {user: 'app_crm', db: 'admin'}});
    expect(info.users[0].roles).toEqual([{role: 'dbOwner', db: 'crm_app'}]);
  });

  it('lists users without exposing credentials', async () => {
    const response = await call(admin, 'GET', users);
    expect(response.statusCode).toBe(200);
    const found = response
      .json()
      .users.find((item: {username: string}) => item.username === 'app_crm');
    expect(found).toMatchObject({
      authDatabase: 'admin',
      roles: [{role: 'dbOwner', db: 'crm_app'}],
    });
    expect(response.body).not.toContain('Crm-Password-2026!');
    expect(response.body).not.toMatch(/storedKey|serverKey|salt/);
  });

  it('validates passwords and admin-only roles', async () => {
    const weak = await call(admin, 'POST', users, {
      username: 'weak',
      password: 'short',
      roles: [{role: 'read', db: 'crm_app'}],
    });
    expect(weak.statusCode).toBe(400);
    const misplaced = await call(admin, 'POST', users, {
      username: 'wrong',
      password: 'Good-Password-2026!',
      roles: [{role: 'readAnyDatabase', db: 'crm_app'}],
    });
    expect(misplaced.statusCode).toBe(400);
    const duplicate = await call(admin, 'POST', users, {
      username: 'app_crm',
      password: 'Crm-Password-2026!',
      roles: [{role: 'read', db: 'crm_app'}],
    });
    expect(duplicate.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('is reserved to MyMongo administrators', async () => {
    const list = await call(reader, 'GET', users);
    expect(list.statusCode).toBe(403);
    const create = await call(reader, 'POST', users, {
      username: 'sneaky',
      password: 'Good-Password-2026!',
      roles: [{role: 'root', db: 'admin'}],
    });
    expect(create.statusCode).toBe(403);
  });

  it('updates roles and password, then drops with confirmation', async () => {
    const updated = await call(admin, 'PATCH', `${users}/admin/app_crm`, {
      password: 'Crm-Password-2027!',
      roles: [{role: 'read', db: 'crm_app'}],
    });
    expect(updated.statusCode).toBe(200);
    const info = await client
      .db('admin')
      .command({usersInfo: {user: 'app_crm', db: 'admin'}});
    expect(info.users[0].roles).toEqual([{role: 'read', db: 'crm_app'}]);
    const wrong = await call(admin, 'DELETE', `${users}/admin/app_crm`, {
      confirm: 'nope',
    });
    expect(wrong.statusCode).toBe(400);
    const dropped = await call(admin, 'DELETE', `${users}/admin/app_crm`, {
      confirm: 'app_crm',
    });
    expect(dropped.statusCode).toBe(200);
  });
});

describe('avatars', () => {
  const pixel =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  it('defaults to a generated avatar seeded by the username', async () => {
    const response = await call(admin, 'GET', '/api/auth/me');
    expect(response.json().user.avatar).toEqual({
      kind: 'generated',
      seed: 'admin',
    });
  });

  it('stores a new generated seed', async () => {
    const response = await call(admin, 'PUT', '/api/auth/avatar', {
      seed: 'k3x9-blue',
    });
    expect(response.statusCode).toBe(200);
    const me = await call(admin, 'GET', '/api/auth/me');
    expect(me.json().user.avatar).toEqual({
      kind: 'generated',
      seed: 'k3x9-blue',
    });
  });

  it('accepts a PNG upload and serves it', async () => {
    const upload = await call(admin, 'POST', '/api/auth/avatar/image', {
      data: `data:image/png;base64,${pixel}`,
    });
    expect(upload.statusCode).toBe(200);
    expect(upload.json().avatar).toMatchObject({kind: 'custom', format: 'png'});
    const image = await call(reader, 'GET', '/api/avatars/admin');
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.rawPayload.equals(Buffer.from(pixel, 'base64'))).toBe(true);
    const anonymous = await call(null, 'GET', '/api/avatars/admin');
    expect(anonymous.statusCode).toBe(401);
  });

  it('rejects SVG, text and oversized files', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    ).toString('base64');
    const rejected = await call(admin, 'POST', '/api/auth/avatar/image', {
      data: svg,
    });
    expect(rejected.statusCode).toBe(400);
    const text = await call(admin, 'POST', '/api/auth/avatar/image', {
      data: Buffer.from('hello').toString('base64'),
    });
    expect(text.statusCode).toBe(400);
    const big = Buffer.alloc(600 * 1024, 1);
    big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const oversized = await call(admin, 'POST', '/api/auth/avatar/image', {
      data: big.toString('base64'),
    });
    expect(oversized.statusCode).toBe(400);
  });

  it('resets to the default generated avatar', async () => {
    const reset = await call(admin, 'DELETE', '/api/auth/avatar');
    expect(reset.json().avatar).toEqual({kind: 'generated', seed: 'admin'});
    const image = await call(admin, 'GET', '/api/avatars/admin');
    expect(image.statusCode).toBe(404);
  });
});

describe('administration', () => {
  it('manages users with a strong password policy', async () => {
    const weak = await call(admin, 'POST', '/api/users', {
      username: 'weak',
      password: 'short',
      role: 'readonly',
    });
    expect(weak.statusCode).toBe(400);
    const forbidden = await call(reader, 'GET', '/api/users');
    expect(forbidden.statusCode).toBe(403);
    const list = await call(admin, 'GET', '/api/users');
    expect(JSON.stringify(list.json())).not.toContain('passwordHash');
  });

  it('records an audit trail without secrets', async () => {
    await context.audit.flush();
    const response = await call(admin, 'GET', '/api/audit?limit=500');
    const entries = response.json().entries as {action: string}[];
    const actions = entries.map(entry => entry.action);
    expect(actions).toContain('document.insert');
    expect(actions).toContain('index.create');
    expect(actions).toContain('auth.login');
    const text = JSON.stringify(entries);
    expect(text).not.toContain(ADMIN_PASSWORD);
    expect(text).not.toContain(mongo.getUri());
  });

  it('protects system databases and confirms drops', async () => {
    const system = await call(
      admin,
      'DELETE',
      '/api/conn/default/databases/admin',
      {
        confirm: 'admin',
      },
    );
    expect(system.statusCode).toBe(403);
    const wrong = await call(
      admin,
      'DELETE',
      '/api/conn/default/databases/shop/collections/imported',
      {confirm: 'nope'},
    );
    expect(wrong.statusCode).toBe(400);
    const ok = await call(
      admin,
      'DELETE',
      '/api/conn/default/databases/shop/collections/imported',
      {confirm: 'imported'},
    );
    expect(ok.statusCode).toBe(200);
  });

  it('logs out', async () => {
    const session = await login('reader', READER_PASSWORD);
    await call(session, 'POST', '/api/auth/logout');
    const after = await call(session, 'GET', '/api/auth/me');
    expect(after.statusCode).toBe(401);
  });
});
