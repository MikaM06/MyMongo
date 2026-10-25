import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {AVATAR_FORMATS, type AvatarFormat} from './users.js';

export const MAX_AVATAR_BYTES = 512 * 1024;

export const AVATAR_MIME: Record<AvatarFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export function detectImageFormat(data: Buffer): AvatarFormat | null {
  if (
    data.length >= 8 &&
    data
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  ) {
    return 'jpeg';
  }
  if (
    data.length >= 12 &&
    data.toString('ascii', 0, 4) === 'RIFF' &&
    data.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

export class AvatarFiles {
  private readonly dir: string;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'avatars');
  }

  private file(username: string, format: AvatarFormat): string {
    return path.join(this.dir, `${username.toLowerCase()}.${format}`);
  }

  async save(
    username: string,
    format: AvatarFormat,
    data: Buffer,
  ): Promise<void> {
    await mkdir(this.dir, {recursive: true});
    await this.remove(username);
    const target = this.file(username, format);
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, data, {mode: 0o600});
    await rename(temp, target);
  }

  async read(username: string, format: AvatarFormat): Promise<Buffer | null> {
    try {
      return await readFile(this.file(username, format));
    } catch {
      return null;
    }
  }

  async remove(username: string): Promise<void> {
    await Promise.all(
      AVATAR_FORMATS.map(format =>
        rm(this.file(username, format), {force: true}),
      ),
    );
  }
}
