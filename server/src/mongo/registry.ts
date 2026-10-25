import {MongoClient} from 'mongodb';
import type {ConnectionConfig} from '../config.js';
import {notFound} from '../lib/errors.js';

export interface PublicConnection {
  id: string;
  label: string;
  hosts: string[];
}

export function extractHosts(uri: string): string[] {
  const withoutScheme = uri.replace(/^mongodb(\+srv)?:\/\//, '');
  const authority = withoutScheme.split(/[/?]/)[0] ?? '';
  const hosts = authority.slice(authority.lastIndexOf('@') + 1);
  return hosts.split(',').filter(Boolean);
}

export class ConnectionRegistry {
  private readonly clients = new Map<string, Promise<MongoClient>>();
  private readonly configs: Map<string, ConnectionConfig>;

  constructor(connections: ConnectionConfig[]) {
    this.configs = new Map(connections.map(item => [item.id, item]));
  }

  list(): PublicConnection[] {
    return [...this.configs.values()].map(item => ({
      id: item.id,
      label: item.label,
      hosts: extractHosts(item.uri),
    }));
  }

  has(id: string): boolean {
    return this.configs.has(id);
  }

  async client(id: string): Promise<MongoClient> {
    const config = this.configs.get(id);
    if (!config) {
      throw notFound(`Connexion « ${id} » inconnue.`);
    }
    let pending = this.clients.get(id);
    if (!pending) {
      const client = new MongoClient(config.uri, {
        appName: 'MyMongo',
        serverSelectionTimeoutMS: 5_000,
        connectTimeoutMS: 5_000,
        maxPoolSize: 20,
      });
      pending = client.connect();
      this.clients.set(id, pending);
      pending.catch(() => {
        if (this.clients.get(id) === pending) {
          this.clients.delete(id);
        }
      });
    }
    return pending;
  }

  async closeAll(): Promise<void> {
    const pending = [...this.clients.values()];
    this.clients.clear();
    await Promise.allSettled(pending.map(async item => (await item).close()));
  }
}
