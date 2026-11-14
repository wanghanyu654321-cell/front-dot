import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll } from 'vitest';
import { Client } from 'pg';
import { FRONT_CLAW_DATABASE_URL, openPerformanceStore, readPerformanceMigration } from '../../src/role-eval/performance-open.js';
import { migratePerformance } from '../../src/role-eval/performance-postgres.js';
import { migrateUp } from '../../src/role-eval/schema-migrations.js';
import { openSql } from '../../src/migration/pg.js';

// M08 真实 PostgreSQL 临时集群（自建自删，随机端口，不连常驻库）。FRONT_CLAW_PG_BIN 可覆盖；
// 本机实测用 PG17 用户态程序 —— 不是线上版本。全部合成数据。
const bin = process.env.FRONT_CLAW_PG_BIN?.trim() || '/usr/lib/postgresql/16/bin';
async function listenPort(): Promise<number> {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => { const a = server.address(); const port = a && typeof a === 'object' ? a.port : 0; server.close(() => resolve(port)); });
    server.on('error', reject);
  });
}
async function run(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(Error(`${command} exited ${code}`)));
  });
}
export let cluster: { base: string; stop(): Promise<void> };
let dbSeq = 0;
export function useCluster() {
beforeAll(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'front-claw-pg-m08-'));
  const port = await listenPort();
  await run(`${bin}/initdb`, ['-D', directory, '-U', 'frontclaw', '--auth=trust', '--no-sync', '--encoding=UTF8']);
  const child: ChildProcess = spawn(`${bin}/postgres`, ['-D', directory, '-p', String(port), '-h', '127.0.0.1', '-k', directory, '-c', 'listen_addresses=127.0.0.1'], { stdio: 'ignore' });
  const base = `postgres://frontclaw@127.0.0.1:${port}`;
  const started = Date.now();
  for (;;) {
    const client = new Client({ connectionString: `${base}/postgres` });
    try { await client.connect(); await client.end(); break; }
    catch { if (Date.now() - started > 20_000) { child.kill('SIGTERM'); throw Error('postgres_not_ready'); } await new Promise(r => setTimeout(r, 200)); }
  }
  cluster = { base, async stop() { child.kill('SIGTERM'); await new Promise(r => child.once('exit', r)); await rm(directory, { recursive: true, force: true }); } };
}, 40_000);
afterAll(async () => { await cluster?.stop(); }, 40_000);
}

export async function freshDatabase(): Promise<string> {
  const name = `m08_case_${++dbSeq}`;
  const admin = new Client({ connectionString: `${cluster.base}/postgres` });
  await admin.connect(); await admin.query(`CREATE DATABASE ${name}`); await admin.end();
  return `${cluster.base}/${name}`;
}

export const env = (url: string) => ({ [FRONT_CLAW_DATABASE_URL]: url });
export async function open(url: string) { return openPerformanceStore(env(url), { requirePostgres: true }); }
export async function rawClient(url: string) { const c = new Client({ connectionString: url }); await c.connect(); return c; }
export async function rawQuery(url: string, sql: string, params: unknown[] = []) {
  const c = await rawClient(url);
  try { return (await c.query(sql, params)).rows as Record<string, unknown>[]; } finally { await c.end(); }
}

/** 先 007 再显式升到 LATEST（含 010）。迁移用例请继续用 open()，保持空库仅 007。 */
export async function applyLatest(url: string): Promise<void> {
  const sql = await openSql(url);
  try {
    await migratePerformance(sql.client, readPerformanceMigration());
    await migrateUp(sql.client, { apply: true });
  } finally {
    await sql.close();
  }
}

/** 打开已升到 LATEST 的库（金额 numeric、status CHECK、store_targets）。 */
export async function openLatest(url: string) {
  await applyLatest(url);
  return openPerformanceStore(env(url), { requirePostgres: true });
}

/** R6 / M08-02：在库上建只授 SELECT 的非超级用户角色，返回用该角色的连接串（trust 认证）。 */
export async function createReadonlyRole(url: string, role = 'frontclaw_migrate_ro'): Promise<string> {
  const parsed = new URL(url);
  const db = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  const admin = new Client({ connectionString: url });
  await admin.connect();
  try {
    await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT; END IF; END $$`);
    await admin.query(`GRANT CONNECT ON DATABASE ${db} TO ${role}`);
    await admin.query(`GRANT USAGE ON SCHEMA front_claw_perf TO ${role}`);
    await admin.query(`GRANT SELECT ON ALL TABLES IN SCHEMA front_claw_perf TO ${role}`);
    await admin.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA front_claw_perf GRANT SELECT ON TABLES TO ${role}`);
    // 收回 public 上可能残留的 CREATE，避免角色被判有 DDL。
    await admin.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC, ${role}`).catch(() => undefined);
    await admin.query(`REVOKE CREATE ON SCHEMA front_claw_perf FROM PUBLIC, ${role}`).catch(() => undefined);
  } finally {
    await admin.end();
  }
  return `postgres://${role}@${parsed.hostname}:${parsed.port}/${encodeURIComponent(db)}`;
}
