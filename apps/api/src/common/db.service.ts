import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, types } from 'pg';
import { ENV, Env } from '../config';

// numeric -> number, bigint -> number, date -> 'YYYY-MM-DD' string (no timezone shifting)
types.setTypeParser(1700, (v) => parseFloat(v));
types.setTypeParser(20, (v) => parseInt(v, 10));
types.setTypeParser(1082, (v) => v);

export interface Q {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  one<T = any>(sql: string, params?: any[]): Promise<T | null>;
}

class Runner implements Q {
  constructor(private readonly exec: (sql: string, params?: any[]) => Promise<{ rows: any[] }>) {}
  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return (await this.exec(sql, params)).rows as T[];
  }
  async one<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }
}

@Injectable()
export class Db extends Runner implements OnModuleDestroy {
  readonly pool: Pool;

  constructor(@Inject(ENV) env: Env) {
    const pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: env.DATABASE_POOL_MAX,
      ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
    });
    super((sql, params) => pool.query(sql, params));
    this.pool = pool;
  }

  async tx<T>(fn: (q: Q) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await fn(new Runner((sql, params) => client.query(sql, params)));
      await client.query('commit');
      return result;
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
