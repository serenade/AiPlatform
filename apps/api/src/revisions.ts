/**
 * 应用 spec 版本控制（git 实现，isomorphic-git 纯 JS，无需 git CLI）。
 * 每个应用一个仓库：APPDATA_DIR/git/<appId>/，每次提交快照两个文件：
 *   - spec.json      当前应用 spec
 *   - db/schema.sql  该 spec 对应的数据库构建脚本（sqlite DDL）
 * 提交消息约定：[agent|manual|restore|undo-session] 说明文字 [thread:<id>]
 */
import fs from 'node:fs';
import path from 'node:path';
import * as git from 'isomorphic-git';
import { APPDATA_DIR, buildSchemaSql, loadAppSpec } from './appdata.js';
import type { AppSpec } from './dbtypes.js';

const REPO_ROOT = path.join(APPDATA_DIR, 'git');
const AUTHOR = { name: 'air', email: 'air@local' };
const HASH_RE = /^[0-9a-f]{7,64}$/;

export class RevisionError extends Error {}

// per-app 提交锁：串行化 commit/undo，避免 isomorphic-git 并发写索引
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(appId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(appId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(appId, next.catch(() => {}));
  return next;
}

const repoDir = (appId: string) => path.join(REPO_ROOT, appId);
const hasRepo = (appId: string) => fs.existsSync(path.join(repoDir(appId), '.git'));

async function writeSnapshot(dir: string, spec: unknown, schemaSql: string): Promise<void> {
  await fs.promises.writeFile(path.join(dir, 'spec.json'), JSON.stringify(spec, null, 2), 'utf8');
  await fs.promises.mkdir(path.join(dir, 'db'), { recursive: true });
  await fs.promises.writeFile(path.join(dir, 'db', 'schema.sql'), schemaSql, 'utf8');
}

async function addAndCommit(dir: string, message: string): Promise<string> {
  await git.add({ fs, dir, filepath: 'spec.json' });
  await git.add({ fs, dir, filepath: 'db/schema.sql' });
  return git.commit({ fs, dir, message, author: AUTHOR });
}

/** 仓库缺失/损坏时重建并以当前 draft spec 提交基线（读路径惰性调用，失败不阻断主流程）。 */
export async function ensureRepo(appId: string): Promise<void> {
  return withLock(appId, async () => {
    const dir = repoDir(appId);
    if (hasRepo(appId)) {
      try {
        await git.log({ fs, dir, depth: 1 });
        return;
      } catch {
        await fs.promises.rm(dir, { recursive: true, force: true });
      }
    }
    await fs.promises.mkdir(dir, { recursive: true });
    await git.init({ fs, dir, defaultBranch: 'main' });
    const spec = loadAppSpec(appId);
    await writeSnapshot(dir, spec, buildSchemaSql(spec));
    await addAndCommit(dir, 'baseline');
  });
}

/** 提交一次 spec + schema 快照（仓库不存在则初始化，本次提交即基线），返回提交 hash。 */
export async function commitSpec(appId: string, spec: unknown, message: string): Promise<string> {
  return withLock(appId, async () => {
    const dir = repoDir(appId);
    if (!hasRepo(appId)) {
      await fs.promises.mkdir(dir, { recursive: true });
      await git.init({ fs, dir, defaultBranch: 'main' });
    }
    const schemaSql = buildSchemaSql(spec as AppSpec);
    await writeSnapshot(dir, spec, schemaSql);
    return addAndCommit(dir, message);
  });
}

export interface Revision {
  hash: string;
  committedAt: string;
  message: string;
  source: string;
  threadId: string | null;
}

/** 版本列表（新→旧），source 与 threadId 从提交消息解析。 */
export async function listRevisions(appId: string, depth = 100): Promise<Revision[]> {
  await ensureRepo(appId);
  const dir = repoDir(appId);
  const log = await git.log({ fs, dir, depth });
  return log.map((e) => {
    const message = String(e.commit.message ?? '').trim();
    const source = message === 'baseline' ? 'baseline' : (/^\[([a-z-]+)\]/.exec(message)?.[1] ?? 'manual');
    const threadId = /\[thread:([^\]\s]+)\]/.exec(message)?.[1] ?? null;
    const ts = e.commit.author?.timestamp ?? Math.floor(Date.now() / 1000);
    return { hash: e.oid, committedAt: new Date(ts * 1000).toISOString(), message, source, threadId };
  });
}

export interface RevisionContent {
  spec: unknown;
  schemaSql: string;
  message: string;
  committedAt: string;
}

/** 读取指定提交的 spec 与 schema 快照（支持短 hash 前缀）。 */
export async function readRevision(appId: string, hash: string): Promise<RevisionContent> {
  if (!HASH_RE.test(hash)) throw new RevisionError('非法的版本 hash');
  const dir = repoDir(appId);
  if (!hasRepo(appId)) throw new RevisionError('版本仓库不存在');
  // isomorphic-git 的 readBlob/readCommit 只接受完整 40 位 oid，短 hash 需先展开
  let oid = hash;
  if (hash.length < 40) {
    try {
      oid = await git.expandOid({ fs, dir, oid: hash });
    } catch {
      throw new RevisionError('版本不存在');
    }
  }
  const specBlob = await git.readBlob({ fs, dir, oid, filepath: 'spec.json' });
  const spec: unknown = JSON.parse(Buffer.from(specBlob.blob).toString('utf8'));
  let schemaSql = '';
  try {
    const s = await git.readBlob({ fs, dir, oid, filepath: 'db/schema.sql' });
    schemaSql = Buffer.from(s.blob).toString('utf8');
  } catch {
    // 早期提交可能没有 schema 文件
  }
  const commit = await git.readCommit({ fs, dir, oid });
  const message = String(commit.commit.message ?? '').trim();
  const ts = commit.commit.author?.timestamp ?? Math.floor(Date.now() / 1000);
  return { spec, schemaSql, message, committedAt: new Date(ts * 1000).toISOString() };
}

/**
 * 会话撤销：找到该会话（threadId）最早一次提交，返回其父提交的 spec 内容作为回退目标。
 * 会话无提交或父提交不存在（基线即会话起点）时抛 THREAD_NO_COMMITS。
 */
export async function findSessionBase(appId: string, threadId: string): Promise<RevisionContent> {
  if (!/^[\w-]{4,80}$/.test(threadId)) throw new RevisionError('非法的会话 id');
  return withLock(appId, async () => {
    const dir = repoDir(appId);
    if (!hasRepo(appId)) throw new RevisionError('THREAD_NO_COMMITS');
    const log = await git.log({ fs, dir, depth: 500 });
    const inSession = log.filter((e) => String(e.commit.message ?? '').includes(`[thread:${threadId}]`));
    if (inSession.length === 0) throw new RevisionError('THREAD_NO_COMMITS');
    const parentOid = inSession[inSession.length - 1].commit.parent?.[0];
    if (!parentOid) throw new RevisionError('THREAD_NO_COMMITS');
    const specBlob = await git.readBlob({ fs, dir, oid: parentOid, filepath: 'spec.json' });
    const spec: unknown = JSON.parse(Buffer.from(specBlob.blob).toString('utf8'));
    let schemaSql = '';
    try {
      const s = await git.readBlob({ fs, dir, oid: parentOid, filepath: 'db/schema.sql' });
      schemaSql = Buffer.from(s.blob).toString('utf8');
    } catch {
      // 早期提交可能没有 schema 文件
    }
    const ts = inSession[inSession.length - 1].commit.author?.timestamp ?? Math.floor(Date.now() / 1000);
    return { spec, schemaSql, message: parentOid, committedAt: new Date(ts * 1000).toISOString() };
  });
}
