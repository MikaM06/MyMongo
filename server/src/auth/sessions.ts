import {randomBytes, timingSafeEqual} from 'node:crypto';
import type {Role} from './users.js';

export interface Session {
  id: string;
  csrfToken: string;
  username: string;
  role: Role;
  stamp: string;
  ip: string;
  createdAt: number;
  lastSeenAt: number;
}

export interface SessionOptions {
  ttlMs: number;
  idleMs: number;
  now?: () => number;
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly now: () => number;

  constructor(private readonly options: SessionOptions) {
    this.now = options.now ?? Date.now;
  }

  create(username: string, role: Role, stamp: string, ip: string): Session {
    const time = this.now();
    const session: Session = {
      id: randomBytes(32).toString('base64url'),
      csrfToken: randomBytes(32).toString('base64url'),
      username,
      role,
      stamp,
      ip,
      createdAt: time,
      lastSeenAt: time,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string | undefined): Session | undefined {
    if (!id) {
      return undefined;
    }
    const session = this.sessions.get(id);
    if (!session) {
      return undefined;
    }
    const time = this.now();
    if (
      time - session.createdAt > this.options.ttlMs ||
      time - session.lastSeenAt > this.options.idleMs
    ) {
      this.sessions.delete(id);
      return undefined;
    }
    session.lastSeenAt = time;
    return session;
  }

  destroy(id: string): void {
    this.sessions.delete(id);
  }

  destroyUser(username: string, exceptId?: string): void {
    const key = username.toLowerCase();
    for (const [id, session] of this.sessions) {
      if (session.username.toLowerCase() === key && id !== exceptId) {
        this.sessions.delete(id);
      }
    }
  }

  updateRole(username: string, role: Role): void {
    const key = username.toLowerCase();
    for (const session of this.sessions.values()) {
      if (session.username.toLowerCase() === key) {
        session.role = role;
      }
    }
  }

  sweep(): void {
    const time = this.now();
    for (const [id, session] of this.sessions) {
      if (
        time - session.createdAt > this.options.ttlMs ||
        time - session.lastSeenAt > this.options.idleMs
      ) {
        this.sessions.delete(id);
      }
    }
  }

  size(): number {
    return this.sessions.size;
  }
}
