/** 外部数据库（MySQL / PostgreSQL）底层操作：连接、测试、建库、列库。 */
import mysql from 'mysql2/promise';
import pg from 'pg';
import type { DbServerRow } from './dbtypes.js';

function mysqlConn(s: DbServerRow, database?: string) {
  return mysql.createConnection({
    host: s.host,
    port: s.port,
    user: s.username,
    password: s.password,
    database,
    ssl: s.ssl === 1 ? { rejectUnauthorized: false } : undefined,
    connectTimeout: 6000,
  });
}

function pgClient(s: DbServerRow, database = 'postgres') {
  return new pg.Client({
    host: s.host,
    port: s.port,
    user: s.username,
    password: s.password,
    database,
    ssl: s.ssl === 1 ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 6000,
  });
}

const identifier = (name: string, s: DbServerRow) => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error(`非法标识符: ${name}`);
  return s.db_type === 'mysql' ? `\`${name}\`` : `"${name}"`;
};

export async function testServerConnection(s: DbServerRow): Promise<{ ok: boolean; message: string }> {
  try {
    if (s.db_type === 'mysql') {
      const conn = await mysqlConn(s);
      try {
        const [ver] = await conn.query('SELECT VERSION() AS v');
        const version = (ver as { v: string }[])[0]?.v ?? '';
        return { ok: true, message: `连接成功 · MySQL ${version}` };
      } finally {
        await conn.end();
      }
    }
    const client = pgClient(s);
    try {
      await client.connect();
      const r = await client.query('SELECT version() AS v');
      return { ok: true, message: `连接成功 · ${(r.rows[0]?.v as string ?? '').split(',')[0]}` };
    } finally {
      await client.end();
    }
  } catch (e) {
    return { ok: false, message: `连接失败: ${(e as Error).message}` };
  }
}

export async function listDatabases(s: DbServerRow): Promise<string[]> {
  if (s.db_type === 'mysql') {
    const conn = await mysqlConn(s);
    try {
      const [rows] = await conn.query("SHOW DATABASES WHERE `Database` NOT IN ('information_schema','mysql','performance_schema','sys')");
      return (rows as { Database: string }[]).map((r) => r.Database);
    } finally {
      await conn.end();
    }
  }
  const client = pgClient(s);
  try {
    await client.connect();
    const r = await client.query(
      `SELECT datname FROM pg_database WHERE datistemplate = false
       AND datname NOT IN ('postgres')`,
    );
    return r.rows.map((row) => row.datname as string);
  } finally {
    await client.end();
  }
}

export async function ensureDatabase(s: DbServerRow, name: string): Promise<void> {
  const q = identifier(name, s);
  if (s.db_type === 'mysql') {
    const conn = await mysqlConn(s);
    try {
      await conn.query(`CREATE DATABASE IF NOT EXISTS ${q} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    } finally {
      await conn.end();
    }
    return;
  }
  // PostgreSQL：CREATE DATABASE 不能在事务内，需先探测再创建
  const client = pgClient(s);
  try {
    await client.connect();
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (exists.rowCount === 0) {
      await client.query(`CREATE DATABASE ${q}`);
    }
  } finally {
    await client.end();
  }
}
