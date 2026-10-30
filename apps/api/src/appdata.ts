/**
 * 应用数据层（需求2核心）：按 spec.models 动态管理记录。
 * 双模式存储 —— 私有 SQLite 文件 / 统一外部数据库服务器上的应用专属库（MySQL / PostgreSQL）。
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import pg from 'pg';
import { db } from './db.js';
import { newId } from './ids.js';
import type { AppSpec, DbServerRow, SpecModel } from './dbtypes.js';

export const APPDATA_DIR = process.env.APP_DATA_DIR ?? path.join(path.dirname(process.argv[1] ?? '.'), 'appdata');
fs.mkdirSync(APPDATA_DIR, { recursive: true });

const IDENT_RE = /^[a-z][a-z0-9_]*$/;
const RESERVED = new Set(['id', 'created_at', 'updated_at']);

interface Row extends Record<string, unknown> {
  id: string;
  created_at: string;
  updated_at: string;
}

interface Backend {
  ensureTable(model: SpecModel): Promise<void>;
  list(model: SpecModel, opts: { limit: number; offset: number; q?: string }): Promise<{ rows: Row[]; total: number }>;
  get(model: SpecModel, recordId: string): Promise<Row | null>;
  create(model: SpecModel, data: Record<string, unknown>): Promise<Row>;
  update(model: SpecModel, recordId: string, data: Record<string, unknown>): Promise<Row>;
  remove(model: SpecModel, recordId: string): Promise<void>;
  countAll(): Promise<Record<string, number>>;
  dispose(): Promise<void>;
}

const now = () => new Date().toISOString();
const assertIdent = (v: string, what: string) => {
  if (!IDENT_RE.test(v)) throw new Error(`非法${what}: ${v}`);
  if (RESERVED.has(v)) throw new Error(`${what}不能为保留字: ${v}`);
  return v;
};

function sqlType(f: { type: string }, dialect: 'sqlite' | 'mysql' | 'pg'): string {
  if (f.type === 'number') return dialect === 'sqlite' ? 'REAL' : dialect === 'mysql' ? 'DOUBLE' : 'DOUBLE PRECISION';
  if (f.type === 'checkbox') return dialect === 'sqlite' ? 'INTEGER' : dialect === 'mysql' ? 'TINYINT(1)' : 'BOOLEAN';
  return 'TEXT';
}

function coerceValue(f: { type: string }, v: unknown): unknown {
  if (v === undefined || v === null || v === '') return null;
  if (f.type === 'number') return Number(v);
  if (f.type === 'checkbox') return v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
  return String(v);
}

function visibleFields(model: SpecModel) {
  return (model.fields ?? []).filter((f) => IDENT_RE.test(f.id) && !RESERVED.has(f.id));
}

function rowToDto(model: SpecModel, r: Row) {
  const out: Record<string, unknown> = {
    id: r.id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  for (const f of visibleFields(model)) out[f.id] = r[`c_${f.id}`];
  return out;
}

// ---------- SQLite 私有库后端 ----------
const sqliteCache = new Map<string, Database.Database>();

function sqliteConn(appId: string): Database.Database {
  let conn = sqliteCache.get(appId);
  if (!conn) {
    conn = new Database(path.join(APPDATA_DIR, `${appId}.db`));
    conn.pragma('journal_mode = WAL');
    sqliteCache.set(appId, conn);
  }
  return conn;
}

class SqliteBackend implements Backend {
  constructor(private appId: string) {}

  private existingColumns(table: string): Set<string> {
    const cols = sqliteConn(this.appId).prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return new Set(cols.map((c) => c.name));
  }

  async ensureTable(model: SpecModel): Promise<void> {
    const conn = sqliteConn(this.appId);
    const table = `t_${assertIdent(model.id, '模型 id')}`;
    conn.exec(
      `CREATE TABLE IF NOT EXISTS ${table} (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    );
    const cols = this.existingColumns(table);
    for (const f of visibleFields(model)) {
      const col = `c_${f.id}`;
      if (!cols.has(col)) conn.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${sqlType(f, 'sqlite')}`);
    }
  }

  async list(model: SpecModel, opts: { limit: number; offset: number; q?: string }) {
    const conn = sqliteConn(this.appId);
    const table = `t_${model.id}`;
    const fields = visibleFields(model);
    let where = '';
    const params: unknown[] = [];
    if (opts.q) {
      const textCols = fields.filter((f) => !['number', 'checkbox', 'relation'].includes(f.type)).map((f) => `c_${f.id}`);
      if (textCols.length > 0) {
        where = `WHERE ${textCols.map((c) => `${c} LIKE ?`).join(' OR ')}`;
        textCols.forEach(() => params.push(`%${opts.q}%`));
      }
    }
    const total = (
      conn.prepare(`SELECT COUNT(*) AS c FROM ${table} ${where}`).get(...params) as { c: number }
    ).c;
    const rows = conn
      .prepare(`SELECT * FROM ${table} ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, opts.limit, opts.offset) as Row[];
    return { rows, total };
  }

  async get(model: SpecModel, recordId: string): Promise<Row | null> {
    const row = sqliteConn(this.appId).prepare(`SELECT * FROM t_${model.id} WHERE id = ?`).get(recordId) as
      | Row
      | undefined;
    return row ?? null;
  }

  async create(model: SpecModel, data: Record<string, unknown>): Promise<Row> {
    const conn = sqliteConn(this.appId);
    const id = newId('rec');
    const cols = ['id', 'created_at', 'updated_at'];
    const vals: unknown[] = [id, now(), now()];
    for (const f of visibleFields(model)) {
      if (data[f.id] !== undefined) {
        cols.push(`c_${f.id}`);
        vals.push(coerceValue(f, data[f.id]));
      }
    }
    conn
      .prepare(`INSERT INTO t_${model.id} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
      .run(...vals);
    return (await this.get(model, id))!;
  }

  async update(model: SpecModel, recordId: string, data: Record<string, unknown>): Promise<Row> {
    const conn = sqliteConn(this.appId);
    const sets: string[] = ['updated_at = ?'];
    const vals: unknown[] = [now()];
    for (const f of visibleFields(model)) {
      if (data[f.id] !== undefined) {
        sets.push(`c_${f.id} = ?`);
        vals.push(coerceValue(f, data[f.id]));
      }
    }
    vals.push(recordId);
    const info = conn.prepare(`UPDATE t_${model.id} SET ${sets.join(',')} WHERE id = ?`).run(...vals);
    if (info.changes === 0) throw new Error('记录不存在');
    return (await this.get(model, recordId))!;
  }

  async remove(model: SpecModel, recordId: string): Promise<void> {
    const info = sqliteConn(this.appId).prepare(`DELETE FROM t_${model.id} WHERE id = ?`).run(recordId);
    if (info.changes === 0) throw new Error('记录不存在');
  }

  async countAll(): Promise<Record<string, number>> {
    const tables = sqliteConn(this.appId)
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 't_%'")
      .all() as { name: string }[];
    const out: Record<string, number> = {};
    for (const t of tables) {
      const mid = t.name.slice(2);
      out[mid] = (sqliteConn(this.appId).prepare(`SELECT COUNT(*) AS c FROM ${t.name}`).get() as { c: number }).c;
    }
    return out;
  }

  async dispose(): Promise<void> {
    sqliteConn(this.appId).close();
    sqliteCache.delete(this.appId);
  }
}

// ---------- 外部数据库（MySQL / PostgreSQL）后端 ----------
class ExternalBackend implements Backend {
  constructor(
    private server: DbServerRow,
    private database: string,
  ) {}

  private dialect(): 'mysql' | 'pg' {
    return this.server.db_type === 'mysql' ? 'mysql' : 'pg';
  }

  private async query<T extends mysql.RowDataPacket[] | any[]>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T> {
    if (this.dialect() === 'mysql') {
      const conn = await mysql.createConnection({
        host: this.server.host,
        port: this.server.port,
        user: this.server.username,
        password: this.server.password,
        database: this.database,
        connectTimeout: 6000,
      });
      try {
        const [rows] = await conn.query(sql, params);
        return rows as T;
      } finally {
        await conn.end();
      }
    }
    const client = new pg.Client({
      host: this.server.host,
      port: this.server.port,
      user: this.server.username,
      password: this.server.password,
      database: this.database,
      connectionTimeoutMillis: 6000,
    });
    try {
      await client.connect();
      const r = await client.query(sql, params);
      return r.rows as T;
    } finally {
      await client.end();
    }
  }

  private async exec(sql: string, params: unknown[] = []): Promise<void> {
    await this.query(sql, params);
  }

  private ph(i: number): string {
    return this.dialect() === 'mysql' ? '?' : `$${i + 1}`;
  }

  private async existingColumns(table: string): Promise<Set<string>> {
    if (this.dialect() === 'mysql') {
      const rows = await this.query<mysql.RowDataPacket[]>('SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [this.database, table]);
      return new Set(rows.map((r) => String((r as { c: string }).c)));
    }
    const rows = await this.query<mysql.RowDataPacket[]>('SELECT column_name AS c FROM information_schema.columns WHERE table_schema = CURRENT_SCHEMA() AND table_name = $1', [table]);
    return new Set(rows.map((r) => String((r as { c: string }).c)));
  }

  async ensureTable(model: SpecModel): Promise<void> {
    const table = `t_${assertIdent(model.id, '模型 id')}`;
    await this.exec(
      `CREATE TABLE IF NOT EXISTS ${table} (
        id VARCHAR(64) PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    );
    const cols = await this.existingColumns(table);
    for (const f of visibleFields(model)) {
      const col = `c_${f.id}`;
      if (!cols.has(col)) await this.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${sqlType(f, this.dialect())}`);
    }
  }

  async list(model: SpecModel, opts: { limit: number; offset: number; q?: string }) {
    const table = `t_${model.id}`;
    const fields = visibleFields(model);
    const conds: string[] = [];
    const params: unknown[] = [];
    if (opts.q) {
      const textCols = fields.filter((f) => !['number', 'checkbox', 'relation'].includes(f.type)).map((f) => `c_${f.id}`);
      for (const c of textCols) {
        conds.push(`${c} LIKE ${this.ph(params.length)}`);
        params.push(`%${opts.q}%`);
      }
    }
    const where = conds.length ? `WHERE ${conds.join(' OR ')}` : '';
    const totalRows = await this.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS c FROM ${table} ${where}`, params);
    const total = Number((totalRows[0] as { c: number | string }).c);
    const rows = await this.query<mysql.RowDataPacket[]>(
      `SELECT * FROM ${table} ${where} ORDER BY created_at DESC LIMIT ${this.ph(params.length)} OFFSET ${this.ph(params.length + 1)}`,
      [...params, opts.limit, opts.offset],
    );
    return { rows: rows as unknown as Row[], total };
  }

  async get(model: SpecModel, recordId: string): Promise<Row | null> {
    const rows = await this.query<mysql.RowDataPacket[]>(`SELECT * FROM t_${model.id} WHERE id = ${this.ph(0)}`, [recordId]);
    return ((rows as unknown as Row[])[0] as Row) ?? null;
  }

  async create(model: SpecModel, data: Record<string, unknown>): Promise<Row> {
    const id = newId('rec');
    const ts = now();
    const cols = ['id', 'created_at', 'updated_at'];
    const params: unknown[] = [id, ts, ts];
    for (const f of visibleFields(model)) {
      if (data[f.id] !== undefined) {
        cols.push(`c_${f.id}`);
        params.push(coerceValue(f, data[f.id]));
      }
    }
    const sql = `INSERT INTO t_${model.id} (${cols.join(',')}) VALUES (${cols.map((_, i) => this.ph(i)).join(',')})`;
    await this.exec(sql, params);
    return (await this.get(model, id))!;
  }

  async update(model: SpecModel, recordId: string, data: Record<string, unknown>): Promise<Row> {
    const sets = ['updated_at = ?'];
    const params: unknown[] = [now()];
    for (const f of visibleFields(model)) {
      if (data[f.id] !== undefined) {
        sets.push(`c_${f.id} = ${this.ph(params.length)}`);
        params.push(coerceValue(f, data[f.id]));
      }
    }
    params.push(recordId);
    await this.exec(`UPDATE t_${model.id} SET ${sets.join(',')} WHERE id = ${this.ph(params.length - 1)}`, params);
    const row = await this.get(model, recordId);
    if (!row) throw new Error('记录不存在');
    return row;
  }

  async remove(model: SpecModel, recordId: string): Promise<void> {
    await this.exec(`DELETE FROM t_${model.id} WHERE id = ${this.ph(0)}`, [recordId]);
  }

  async countAll(): Promise<Record<string, number>> {
    const rows = this.dialect() === 'mysql'
      ? await this.query<mysql.RowDataPacket[]>(
          "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME LIKE 't_%'",
          [this.database],
        )
      : await this.query<mysql.RowDataPacket[]>(
          "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = CURRENT_SCHEMA() AND table_name LIKE 't_%'",
        );
    const out: Record<string, number> = {};
    for (const r of rows) {
      const table = String((r as { t: string }).t);
      const c = await this.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS c FROM ${table}`);
      out[table.slice(2)] = Number((c[0] as { c: number | string }).c);
    }
    return out;
  }

  async dispose(): Promise<void> {}
}

// ---------- spec / 绑定解析 ----------
export function loadAppSpec(appId: string): AppSpec {
  const app = db
    .prepare('SELECT current_draft_spec_version_id, current_published_spec_version_id FROM apps WHERE id = ?')
    .get(appId) as { current_draft_spec_version_id: string; current_published_spec_version_id: string | null } | undefined;
  if (!app) throw new Error('应用不存在');
  const vid = app.current_draft_spec_version_id;
  const row = db.prepare('SELECT spec_json FROM spec_versions WHERE id = ?').get(vid) as
    | { spec_json: string }
    | undefined;
  if (!row) throw new Error('应用 spec 缺失');
  return JSON.parse(row.spec_json) as AppSpec;
}

interface BindingRow {
  app_id: string;
  mode: string;
  db_server_id: string | null;
  database_name: string | null;
}

function getBinding(appId: string): BindingRow {
  const b = db.prepare('SELECT * FROM app_data_bindings WHERE app_id = ?').get(appId) as BindingRow | undefined;
  return b ?? { app_id: appId, mode: 'sqlite', db_server_id: null, database_name: null };
}

async function resolveBackend(appId: string): Promise<Backend> {
  const b = getBinding(appId);
  if (b.mode === 'external') {
    if (!b.db_server_id || !b.database_name) throw new Error('外部绑定配置不完整');
    const server = db.prepare('SELECT * FROM db_servers WHERE id = ?').get(b.db_server_id) as
      | DbServerRow
      | undefined;
    if (!server) throw new Error('绑定的数据库服务器不存在');
    return new ExternalBackend(server, b.database_name);
  }
  return new SqliteBackend(appId);
}
export { resolveBackend };

/** 绑定后按当前 spec 同步全部模型表结构（幂等）。 */
export async function syncAppSchema(appId: string): Promise<void> {
  const spec = loadAppSpec(appId);
  const backend = await resolveBackend(appId);
  try {
    for (const model of spec.models ?? []) await backend.ensureTable(model);
  } finally {
    await backend.dispose();
  }
}

/** spec 变更后把 seeds 示例数据落到应用数据表（幂等：仅向空表播种）。 */
export async function syncAppSeeds(appId: string): Promise<void> {
  const spec = loadAppSpec(appId);
  const seeds = spec.seeds ?? [];
  if (seeds.length === 0) return;
  const backend = await resolveBackend(appId);
  try {
    for (const seed of seeds) {
      const model = (spec.models ?? []).find((m) => m.id === seed.modelId);
      if (!model) continue;
      await backend.ensureTable(model);
      const { total } = await backend.list(model, { limit: 1, offset: 0 });
      if (total > 0) continue;
      for (const row of seed.rows ?? []) {
        if (row && typeof row === 'object') await backend.create(model, row as Record<string, unknown>);
      }
    }
  } finally {
    await backend.dispose();
  }
}

/** 按 spec 生成 sqlite 方言的目标态建表 DDL（作为数据库构建脚本快照随 spec 提交进 git）。 */
export function buildSchemaSql(spec: AppSpec): string {
  const lines: string[] = [
    '-- AiPlatform 应用数据库构建脚本快照（sqlite 方言）',
    '-- 由应用 spec 自动生成，请勿手工编辑；字段类型映射与运行时 ensureTable 保持一致',
    '',
  ];
  for (const model of spec.models ?? []) {
    if (!IDENT_RE.test(model.id)) continue;
    const cols = [
      '  id TEXT PRIMARY KEY',
      '  created_at TEXT NOT NULL',
      '  updated_at TEXT NOT NULL',
      ...visibleFields(model).map((f) => `  c_${f.id} ${sqlType(f, 'sqlite')}`),
    ];
    lines.push(`-- 模型: ${model.name ?? model.id}`, `CREATE TABLE IF NOT EXISTS t_${model.id} (`, `${cols.join(',\n')}`, ');', '');
  }
  return lines.join('\n');
}

/** 备份应用私有 SQLite 数据库文件，返回临时文件路径（外部库模式不支持，抛 EXTERNAL_DB）。 */
export async function backupAppDb(appId: string): Promise<string> {
  const b = getBinding(appId);
  if (b.mode !== 'sqlite') throw new Error('EXTERNAL_DB');
  const dest = path.join(APPDATA_DIR, 'backups', `${appId}-${Date.now()}.db`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await sqliteConn(appId).backup(dest);
  return dest;
}
