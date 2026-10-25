import {mkdir, readFile, rename, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {badRequest, conflict, notFound} from '../lib/errors.js';
import {hashPassword, validatePasswordStrength} from './password.js';

export const ROLES = ['admin', 'readonly'] as const;
export type Role = (typeof ROLES)[number];

export const usernameSchema = z
  .string()
  .trim()
  .regex(
    /^[a-zA-Z0-9._-]{3,32}$/,
    'Identifiant : 3 à 32 caractères (lettres, chiffres, . _ -)',
  );

export const AVATAR_FORMATS = ['png', 'jpeg', 'webp'] as const;
export type AvatarFormat = (typeof AVATAR_FORMATS)[number];

export const avatarSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('generated'),
    seed: z.string().min(1).max(64),
  }),
  z.object({
    kind: z.literal('custom'),
    format: z.enum(AVATAR_FORMATS),
    version: z.number().int().nonnegative(),
  }),
]);

export type Avatar = z.infer<typeof avatarSchema>;

const storedUserSchema = z.object({
  username: z.string(),
  role: z.enum(ROLES),
  passwordHash: z.string(),
  avatar: avatarSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type StoredUser = z.infer<typeof storedUserSchema>;

export interface PublicUser {
  username: string;
  role: Role;
  avatar: Avatar;
  createdAt: string;
  updatedAt: string;
}

export function credentialStamp(user: StoredUser): string {
  return user.passwordHash.slice(-16);
}

export function toPublicUser(user: StoredUser): PublicUser {
  return {
    username: user.username,
    role: user.role,
    avatar: user.avatar ?? {kind: 'generated', seed: user.username},
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export class UserStore {
  private users: StoredUser[] = [];
  private queue: Promise<void> = Promise.resolve();
  private readonly file: string;
  private mtimeMs = 0;
  private checkedAt = 0;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'users.json');
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.file, 'utf8');
      this.users = z.array(storedUserSchema).parse(JSON.parse(raw));
      this.mtimeMs = (await stat(this.file)).mtimeMs;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.users = [];
        this.mtimeMs = 0;
        return;
      }
      throw new Error(
        `Fichier utilisateurs illisible (${this.file}) : ${(error as Error).message}`,
      );
    }
  }

  async refresh(maxAgeMs = 2_000): Promise<void> {
    const now = Date.now();
    if (now - this.checkedAt < maxAgeMs) {
      return;
    }
    this.checkedAt = now;
    const info = await stat(this.file).catch(() => null);
    if ((info?.mtimeMs ?? 0) !== this.mtimeMs) {
      await this.queue;
      await this.load();
    }
  }

  count(): number {
    return this.users.length;
  }

  list(): PublicUser[] {
    return this.users
      .map(toPublicUser)
      .sort((a, b) => a.username.localeCompare(b.username));
  }

  find(username: string): StoredUser | undefined {
    const key = username.toLowerCase();
    return this.users.find(user => user.username.toLowerCase() === key);
  }

  async create(
    username: string,
    password: string,
    role: Role,
  ): Promise<PublicUser> {
    const name = usernameSchema.parse(username);
    if (this.find(name)) {
      throw conflict(`L'utilisateur « ${name} » existe déjà.`);
    }
    this.assertPassword(password);
    const now = new Date().toISOString();
    const user: StoredUser = {
      username: name,
      role,
      passwordHash: await hashPassword(password),
      createdAt: now,
      updatedAt: now,
    };
    await this.mutate(() => this.users.push(user));
    return toPublicUser(user);
  }

  async update(
    username: string,
    changes: {role?: Role; password?: string},
  ): Promise<PublicUser> {
    const user = this.require(username);
    if (changes.role && changes.role !== 'admin' && user.role === 'admin') {
      this.assertNotLastAdmin(user);
    }
    let passwordHash: string | undefined;
    if (changes.password !== undefined) {
      this.assertPassword(changes.password);
      passwordHash = await hashPassword(changes.password);
    }
    await this.mutate(() => {
      if (changes.role) {
        user.role = changes.role;
      }
      if (passwordHash) {
        user.passwordHash = passwordHash;
      }
      user.updatedAt = new Date().toISOString();
    });
    return toPublicUser(user);
  }

  async setAvatar(username: string, avatar: Avatar): Promise<PublicUser> {
    const user = this.require(username);
    await this.mutate(() => {
      user.avatar = avatar;
      user.updatedAt = new Date().toISOString();
    });
    return toPublicUser(user);
  }

  async remove(username: string): Promise<void> {
    const user = this.require(username);
    if (user.role === 'admin') {
      this.assertNotLastAdmin(user);
    }
    await this.mutate(() => {
      this.users = this.users.filter(item => item !== user);
    });
  }

  private require(username: string): StoredUser {
    const user = this.find(username);
    if (!user) {
      throw notFound(`Utilisateur « ${username} » introuvable.`);
    }
    return user;
  }

  private assertPassword(password: string): void {
    const problem = validatePasswordStrength(password);
    if (problem) {
      throw badRequest(problem);
    }
  }

  private assertNotLastAdmin(user: StoredUser): void {
    const admins = this.users.filter(item => item.role === 'admin');
    if (admins.length === 1 && admins[0] === user) {
      throw badRequest(
        'Impossible : il doit rester au moins un administrateur.',
      );
    }
  }

  private async mutate(change: () => void): Promise<void> {
    const run = this.queue.then(async () => {
      change();
      await mkdir(path.dirname(this.file), {recursive: true});
      const temp = `${this.file}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify(this.users, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temp, this.file);
      this.mtimeMs = (await stat(this.file)).mtimeMs;
    });
    this.queue = run.catch(() => undefined);
    await run;
  }
}
