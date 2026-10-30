import Database from 'better-sqlite3';
import { randomBytes, scryptSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newId } from './ids.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, '..', 'data', 'platform.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8'));

// ---------- 增量迁移（已有库补列；CREATE TABLE IF NOT EXISTS 不会更新旧表结构） ----------
function tryAddColumn(table: string, column: string, decl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}
tryAddColumn('apps', 'ai_profile_id', 'TEXT');
tryAddColumn('ai_profiles', 'last_test_at', 'TEXT');
tryAddColumn('ai_profiles', 'last_test_message', 'TEXT');

// ---------- 密码 ----------
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && candidate.equals(expected);
}

// ---------- 种子数据 ----------
export function seedIfEmpty() {
  const userCount = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
  if (userCount > 0) return;

  const now = new Date().toISOString();
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@air.local';
  const password = process.env.SEED_ADMIN_PASSWORD ?? '12345678';
  const userId = newId('user');
  const tenantId = newId('tenant');

  db.prepare(
    'INSERT INTO users (id, email, password_hash, display_name, avatar_url, created_at) VALUES (?,?,?,?,?,?)',
  ).run(userId, email, hashPassword(password), '管理员', null, now);

  db.prepare('INSERT INTO tenants (id, name, slug, avatar_url) VALUES (?,?,?,?)').run(
    tenantId,
    '默认租户',
    'default',
    null,
  );

  db.prepare(
    'INSERT INTO memberships (user_id, tenant_id, role, status, is_current) VALUES (?,?,?,?,1)',
  ).run(userId, tenantId, 'admin', 'active');

  console.log(`[api] seeded admin: ${email} / ${password}`);
}
