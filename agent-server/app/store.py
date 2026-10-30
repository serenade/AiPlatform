"""SQLite thread store：threads / thread_items / proposals / runs。"""

from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from chatkit.store import Store
from chatkit.types import Attachment, Page, ThreadItem, ThreadMetadata
from pydantic import TypeAdapter

ThreadItemAdapter: TypeAdapter[ThreadItem] = TypeAdapter(ThreadItem)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class SQLiteStore(Store[Any]):
    def __init__(self, db_path: str | Path):
        self.db_path = str(db_path)
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._migrate()

    def _migrate(self) -> None:
        with self._lock:
            self._conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS threads (
                  id TEXT PRIMARY KEY,
                  app_id TEXT,
                  user_id TEXT,
                  title TEXT,
                  pinned INTEGER NOT NULL DEFAULT 0,
                  visibility TEXT NOT NULL DEFAULT 'private',
                  metadata TEXT NOT NULL DEFAULT '{}',
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS thread_items (
                  rowid_seq INTEGER PRIMARY KEY AUTOINCREMENT,
                  id TEXT NOT NULL,
                  thread_id TEXT NOT NULL,
                  item_json TEXT NOT NULL,
                  created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_items_thread ON thread_items(thread_id, rowid_seq);
                CREATE TABLE IF NOT EXISTS proposals (
                  thread_id TEXT PRIMARY KEY,
                  app_id TEXT NOT NULL,
                  proposal_json TEXT NOT NULL,
                  errors TEXT NOT NULL DEFAULT '[]',
                  status TEXT NOT NULL DEFAULT 'pending',
                  result_json TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS runs (
                  id TEXT PRIMARY KEY,
                  thread_id TEXT,
                  app_id TEXT,
                  status TEXT NOT NULL,
                  detail TEXT NOT NULL DEFAULT '{}',
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                """
            )
            self._conn.commit()

    # ---------- ChatKit Store 接口 ----------
    async def load_thread(self, thread_id: str, context: Any) -> ThreadMetadata:
        with self._lock:
            row = self._conn.execute('SELECT * FROM threads WHERE id = ?', (thread_id,)).fetchone()
        if row is None:
            raise NotFoundErrorCompat(f'Thread {thread_id} not found')
        return self._row_to_thread(row)

    async def save_thread(self, thread: ThreadMetadata, context: Any) -> None:
        meta = dict(thread.metadata or {})
        app_id = meta.get('app_id')
        user_id = meta.get('user_id')
        with self._lock:
            self._conn.execute(
                """INSERT INTO threads (id, app_id, user_id, title, pinned, visibility, metadata, created_at, updated_at)
                   VALUES (?,?,?,?,0,'private',?,?,?)
                   ON CONFLICT(id) DO UPDATE SET title=excluded.title,
                     metadata=excluded.metadata, updated_at=excluded.updated_at""",
                (thread.id, app_id, user_id, thread.title, json.dumps(meta, ensure_ascii=False), _now(), _now()),
            )
            self._conn.commit()

    async def load_threads(self, limit: int, after: str | None, order: str, context: Any) -> Page[ThreadMetadata]:
        sql = 'SELECT * FROM threads'
        params: list[Any] = []
        if after:
            sql += ' WHERE rowid < (SELECT rowid FROM threads WHERE id = ?)'
            params.append(after)
        sql += ' ORDER BY rowid ' + ('ASC' if order == 'asc' else 'DESC')
        sql += ' LIMIT ?'
        params.append(limit + 1)
        with self._lock:
            rows = self._conn.execute(sql, params).fetchall()
        has_more = len(rows) > limit
        rows = rows[:limit]
        return Page(
            data=[self._row_to_thread(r) for r in rows],
            has_more=has_more,
            after=rows[-1]['id'] if has_more and rows else None,
        )

    async def add_thread_item(self, thread_id: str, item: ThreadItem, context: Any) -> None:
        with self._lock:
            self._conn.execute(
                'INSERT INTO thread_items (id, thread_id, item_json, created_at) VALUES (?,?,?,?)',
                (item.id, thread_id, item.model_dump_json(by_alias=True, exclude_none=True, context={'exclude_metadata': True}), _now()),
            )
            self._conn.commit()

    async def save_item(self, thread_id: str, item: ThreadItem, context: Any) -> None:
        with self._lock:
            cur = self._conn.execute(
                'UPDATE thread_items SET item_json = ? WHERE id = ? AND thread_id = ?',
                (item.model_dump_json(by_alias=True, exclude_none=True, context={'exclude_metadata': True}), item.id, thread_id),
            )
            if cur.rowcount == 0:
                self._conn.execute(
                    'INSERT INTO thread_items (id, thread_id, item_json, created_at) VALUES (?,?,?,?)',
                    (item.id, thread_id, item.model_dump_json(by_alias=True, exclude_none=True, context={'exclude_metadata': True}), _now()),
                )
            self._conn.commit()

    async def load_thread_items(self, thread_id: str, after: str | None, limit: int, order: str, context: Any) -> Page[ThreadItem]:
        sql = 'SELECT * FROM thread_items WHERE thread_id = ?'
        params: list[Any] = [thread_id]
        if after:
            sql += ' AND rowid_seq > (SELECT rowid_seq FROM thread_items WHERE id = ? AND thread_id = ?)'
            params += [after, thread_id]
        sql += ' ORDER BY rowid_seq ' + ('ASC' if order == 'asc' else 'DESC')
        sql += ' LIMIT ?'
        params.append(limit + 1)
        with self._lock:
            rows = self._conn.execute(sql, params).fetchall()
        has_more = len(rows) > limit
        rows = rows[:limit]
        items = [ThreadItemAdapter.validate_json(r['item_json']) for r in rows]
        return Page(data=items, has_more=has_more, after=rows[-1]['id'] if has_more and rows else None)

    async def load_item(self, thread_id: str, item_id: str, context: Any) -> ThreadItem:
        with self._lock:
            row = self._conn.execute(
                'SELECT * FROM thread_items WHERE id = ? AND thread_id = ?', (item_id, thread_id)
            ).fetchone()
        if row is None:
            raise NotFoundErrorCompat(f'Item {item_id} not found')
        return ThreadItemAdapter.validate_json(row['item_json'])

    async def delete_thread(self, thread_id: str, context: Any) -> None:
        with self._lock:
            self._conn.execute('DELETE FROM thread_items WHERE thread_id = ?', (thread_id,))
            self._conn.execute('DELETE FROM threads WHERE id = ?', (thread_id,))
            self._conn.commit()

    async def delete_thread_item(self, thread_id: str, item_id: str, context: Any) -> None:
        with self._lock:
            self._conn.execute('DELETE FROM thread_items WHERE id = ? AND thread_id = ?', (item_id, thread_id))
            self._conn.commit()

    async def save_attachment(self, attachment: Attachment, context: Any) -> None:  # pragma: no cover
        raise NotImplementedError('Attachments are not supported in MVP')

    async def load_attachment(self, attachment_id: str, context: Any) -> Attachment:  # pragma: no cover
        raise NotImplementedError('Attachments are not supported in MVP')

    async def delete_attachment(self, attachment_id: str, context: Any) -> None:  # pragma: no cover
        raise NotImplementedError('Attachments are not supported in MVP')

    # ---------- 扩展：搜索 / 置顶 / 可见性 / 提案 / runs ----------
    def get_thread_items(self, thread_id: str, limit: int = 500) -> list[dict[str, Any]]:
        """按时间正序返回会话内全部消息条目（已解析的 JSON），供只读浏览。"""
        with self._lock:
            rows = self._conn.execute(
                'SELECT item_json, created_at FROM thread_items WHERE thread_id = ? ORDER BY rowid_seq ASC LIMIT ?',
                (thread_id, limit),
            ).fetchall()
        items: list[dict[str, Any]] = []
        for r in rows:
            try:
                obj = json.loads(r['item_json'])
            except (TypeError, ValueError):
                continue
            obj['_createdAt'] = r['created_at']
            items.append(obj)
        return items

    def get_thread(self, thread_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(
                'SELECT id, title, app_id, created_at, updated_at FROM threads WHERE id = ?', (thread_id,)
            ).fetchone()
        return dict(row) if row else None

    def search_threads(self, query: str, limit: int = 50) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                'SELECT id, title, app_id, pinned, visibility, created_at, updated_at FROM threads WHERE title LIKE ? ORDER BY updated_at DESC LIMIT ?',
                (f'%{query}%', limit),
            ).fetchall()
        return [dict(r) for r in rows]

    def set_pinned(self, thread_id: str, pinned: bool) -> bool:
        return self._update_thread_flag(thread_id, {'pinned': 1 if pinned else 0})

    def set_visibility(self, thread_id: str, visibility: str) -> bool:
        return self._update_thread_flag(thread_id, {'visibility': visibility})

    def _update_thread_flag(self, thread_id: str, fields: dict[str, Any]) -> bool:
        sets = ', '.join(f'{k} = ?' for k in fields)
        with self._lock:
            cur = self._conn.execute(
                f'UPDATE threads SET {sets}, updated_at = ? WHERE id = ?', (*fields.values(), _now(), thread_id)
            )
            self._conn.commit()
        return cur.rowcount > 0

    def save_proposal(self, thread_id: str, app_id: str, patch: dict[str, Any], errors: list[str]) -> None:
        with self._lock:
            self._conn.execute(
                """INSERT INTO proposals (thread_id, app_id, proposal_json, errors, status, created_at, updated_at)
                   VALUES (?,?,?,?,'pending',?,?)
                   ON CONFLICT(thread_id) DO UPDATE SET proposal_json=excluded.proposal_json,
                     errors=excluded.errors, status='pending', result_json=NULL, updated_at=excluded.updated_at""",
                (thread_id, app_id, json.dumps(patch, ensure_ascii=False), json.dumps(errors, ensure_ascii=False), _now(), _now()),
            )
            self._conn.commit()

    def get_proposal(self, thread_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute('SELECT * FROM proposals WHERE thread_id = ?', (thread_id,)).fetchone()
        if row is None:
            return None
        return {
            'threadId': row['thread_id'],
            'appId': row['app_id'],
            'proposal': json.loads(row['proposal_json']),
            'errors': json.loads(row['errors']),
            'status': row['status'],
            'result': json.loads(row['result_json']) if row['result_json'] else None,
            'createdAt': row['created_at'],
        }

    def mark_proposal_applied(self, thread_id: str, result: dict[str, Any]) -> None:
        with self._lock:
            self._conn.execute(
                "UPDATE proposals SET status = 'applied', result_json = ?, updated_at = ? WHERE thread_id = ?",
                (json.dumps(result, ensure_ascii=False), _now(), thread_id),
            )
            self._conn.commit()

    # ---------- runs ----------
    def create_run(self, run_id: str, thread_id: str | None, app_id: str | None, detail: dict[str, Any]) -> dict[str, Any]:
        now = _now()
        with self._lock:
            self._conn.execute(
                'INSERT INTO runs (id, thread_id, app_id, status, detail, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
                (run_id, thread_id, app_id, 'succeeded', json.dumps(detail, ensure_ascii=False), now, now),
            )
            self._conn.commit()
        return self.get_run(run_id)  # type: ignore[return-value]

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute('SELECT * FROM runs WHERE id = ?', (run_id,)).fetchone()
        if row is None:
            return None
        return {
            'id': row['id'],
            'threadId': row['thread_id'],
            'appId': row['app_id'],
            'status': row['status'],
            'detail': json.loads(row['detail']),
            'createdAt': row['created_at'],
            'updatedAt': row['updated_at'],
        }

    def update_run_status(self, run_id: str, status: str) -> bool:
        with self._lock:
            cur = self._conn.execute(
                'UPDATE runs SET status = ?, updated_at = ? WHERE id = ?', (status, _now(), run_id)
            )
            self._conn.commit()
        return cur.rowcount > 0

    # ---------- helpers ----------
    @staticmethod
    def _row_to_thread(row: sqlite3.Row) -> ThreadMetadata:
        meta = json.loads(row['metadata'])
        return ThreadMetadata(
            id=row['id'],
            title=row['title'],
            created_at=row['created_at'],
            metadata=meta,
        )


class NotFoundErrorCompat(Exception):
    """与 chatkit.store.NotFoundError 同义的本地错误（避免私有导入差异）。"""
