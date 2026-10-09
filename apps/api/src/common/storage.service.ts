import { Inject, Injectable } from '@nestjs/common';
import { createConnection } from 'node:net';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { ENV, Env } from '../config';
import { IntegrationsService } from './integrations.service';

export interface StoredFile { body: Buffer }

@Injectable()
export class StorageService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  async put(key: string, body: Buffer, mime: string): Promise<void> {
    if (this.env.STORAGE_DRIVER === 'supabase') {
      const res = await fetch(this.objectUrl(key), {
        method: 'POST',
        headers: { ...this.authHeaders(), 'Content-Type': mime, 'x-upsert': 'false' },
        body: new Uint8Array(body),
      });
      if (!res.ok) throw new Error(`storage upload failed: ${res.status}`);
      return;
    }
    const file = this.localPath(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body, { flag: 'wx' });
  }

  async get(key: string): Promise<Buffer> {
    if (this.env.STORAGE_DRIVER === 'supabase') {
      const res = await fetch(this.objectUrl(key), { headers: this.authHeaders() });
      if (!res.ok) throw new Error(`storage download failed: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }
    return fs.readFile(this.localPath(key));
  }

  async remove(key: string): Promise<void> {
    if (this.env.STORAGE_DRIVER === 'supabase') {
      await fetch(this.objectUrl(key), { method: 'DELETE', headers: this.authHeaders() });
      return;
    }
    await fs.rm(this.localPath(key), { force: true });
  }

  private objectUrl(key: string) {
    const encoded = key.split('/').map(encodeURIComponent).join('/');
    return `${this.env.SUPABASE_URL}/storage/v1/object/${this.env.SUPABASE_STORAGE_BUCKET}/${encoded}`;
  }
  private authHeaders() {
    return { Authorization: `Bearer ${this.env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: this.env.SUPABASE_SERVICE_ROLE_KEY! };
  }
  private localPath(key: string) {
    const root = path.resolve(this.env.STORAGE_DIR);
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error('invalid storage key'); // path traversal guard
    return full;
  }
}

/** Optional virus scan through a clamd daemon (INSTREAM). Host and port come from API & Integrations. */
@Injectable()
export class MalwareScanner {
  constructor(private readonly integrations: IntegrationsService) {}

  async enabled(): Promise<boolean> {
    const c = await this.integrations.resolve('malware_scan');
    return c.enabled && Boolean(c.values.host);
  }

  async ping(): Promise<boolean> {
    const c = await this.integrations.resolve('malware_scan');
    if (!c.values.host) throw new Error('No host is configured');
    return new Promise<boolean>((resolve, reject) => {
      const sock = createConnection({ host: c.values.host, port: Number(c.values.port ?? 3310) });
      let reply = '';
      sock.setTimeout(8000, () => { sock.destroy(); reject(new Error('The scanner did not answer in time')); });
      sock.on('error', reject);
      sock.on('data', (d) => (reply += d.toString()));
      sock.on('close', () => resolve(reply.includes('PONG')));
      sock.write('zPING\0');
    });
  }

  async clean(body: Buffer): Promise<boolean> {
    const c = await this.integrations.resolve('malware_scan');
    if (!c.enabled || !c.values.host) return true;
    return new Promise<boolean>((resolve, reject) => {
      const sock = createConnection({ host: c.values.host, port: Number(c.values.port ?? 3310) });
      let reply = '';
      sock.setTimeout(30000, () => { sock.destroy(); reject(new Error('virus scan timed out')); });
      sock.on('error', reject);
      sock.on('data', (d) => (reply += d.toString()));
      sock.on('close', () => (reply.includes('FOUND') ? resolve(false) : reply.includes('OK') ? resolve(true) : reject(new Error(`unexpected scanner reply: ${reply}`))));
      sock.write('zINSTREAM\0');
      const chunk = 64 * 1024;
      for (let i = 0; i < body.length; i += chunk) {
        const part = body.subarray(i, i + chunk);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(part.length);
        sock.write(len);
        sock.write(part);
      }
      sock.write(Buffer.alloc(4));
    });
  }
}
