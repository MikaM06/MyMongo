import {createReadStream} from 'node:fs';
import {appendFile, mkdir, rename, stat} from 'node:fs/promises';
import path from 'node:path';
import type {FastifyBaseLogger} from 'fastify';

export interface AuditEntry {
  at: string;
  user: string;
  ip: string;
  action: string;
  outcome: 'success' | 'failure';
  connection?: string;
  database?: string;
  collection?: string;
  details?: Record<string, string | number | boolean | null>;
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const TAIL_BYTES = 512 * 1024;
const SENSITIVE_KEY = /pass|secret|token|uri|cookie|key/i;

export class AuditLog {
  private readonly file: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    dataDir: string,
    private readonly logger: FastifyBaseLogger,
  ) {
    this.file = path.join(dataDir, 'audit.log');
  }

  record(entry: Omit<AuditEntry, 'at'>): void {
    const details = entry.details
      ? Object.fromEntries(
          Object.entries(entry.details).filter(
            ([key]) => !SENSITIVE_KEY.test(key),
          ),
        )
      : undefined;
    const line: AuditEntry = {at: new Date().toISOString(), ...entry, details};
    this.logger.info({audit: line}, `audit ${line.action}`);
    this.queue = this.queue
      .then(() => this.append(`${JSON.stringify(line)}\n`))
      .catch(error =>
        this.logger.error(
          {err: error},
          "Écriture du journal d'audit impossible",
        ),
      );
  }

  async flush(): Promise<void> {
    await this.queue;
  }

  async recent(limit: number): Promise<AuditEntry[]> {
    await this.queue;
    let size: number;
    try {
      size = (await stat(this.file)).size;
    } catch {
      return [];
    }
    const start = Math.max(0, size - TAIL_BYTES);
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      createReadStream(this.file, {start})
        .on('data', chunk => chunks.push(chunk as Buffer))
        .on('end', resolve)
        .on('error', reject);
    });
    const lines = Buffer.concat(chunks).toString('utf8').split('\n');
    if (start > 0) {
      lines.shift();
    }
    const entries: AuditEntry[] = [];
    for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
      if (!lines[i]) {
        continue;
      }
      try {
        entries.push(JSON.parse(lines[i]) as AuditEntry);
      } catch {
        continue;
      }
    }
    return entries;
  }

  private async append(text: string): Promise<void> {
    await mkdir(path.dirname(this.file), {recursive: true});
    const size = await stat(this.file).then(
      info => info.size,
      () => 0,
    );
    if (size > MAX_FILE_BYTES) {
      await rename(this.file, `${this.file}.1`);
    }
    await appendFile(this.file, text, {encoding: 'utf8', mode: 0o600});
  }
}
