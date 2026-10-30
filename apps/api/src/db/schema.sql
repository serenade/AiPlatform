CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  avatar_url TEXT
);

CREATE TABLE IF NOT EXISTS memberships (
  user_id TEXT NOT NULL REFERENCES users(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  is_current INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, tenant_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS apps (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  description TEXT,
  icon_asset_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  current_draft_spec_version_id TEXT,
  current_published_spec_version_id TEXT,
  ai_profile_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS spec_versions (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES apps(id),
  version INTEGER NOT NULL,
  spec_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  UNIQUE (app_id, version)
);

CREATE INDEX IF NOT EXISTS idx_apps_tenant ON apps(tenant_id);
CREATE INDEX IF NOT EXISTS idx_spec_versions_app ON spec_versions(app_id);

-- ---------- 需求2：数据库管理 ----------
-- 统一外部数据库服务器配置（MySQL / PostgreSQL）
CREATE TABLE IF NOT EXISTS db_servers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  db_type TEXT NOT NULL,                    -- mysql | postgresql
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  username TEXT NOT NULL,
  password TEXT NOT NULL DEFAULT '',
  ssl INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unknown',   -- unknown | ok | error
  last_test_at TEXT,
  last_test_message TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);

-- 应用数据存储绑定：私有 sqlite 文件 或 挂到某个外部服务器上的专属库
CREATE TABLE IF NOT EXISTS app_data_bindings (
  app_id TEXT PRIMARY KEY REFERENCES apps(id),
  mode TEXT NOT NULL DEFAULT 'sqlite',      -- sqlite | external
  db_server_id TEXT REFERENCES db_servers(id),
  database_name TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

-- ---------- 需求3：团队设置 ----------
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,                       -- kebab-case 标识
  title TEXT NOT NULL,
  description TEXT,
  content TEXT NOT NULL DEFAULT '',         -- SKILL.md 内容
  version TEXT NOT NULL DEFAULT '0.1.0',
  status TEXT NOT NULL DEFAULT 'enabled',   -- enabled | disabled
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  headers_json TEXT,
  status TEXT NOT NULL DEFAULT 'untested',  -- untested | ok | error
  tools_json TEXT,                          -- 最近一次 discover 的工具列表
  last_test_at TEXT,
  last_test_message TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, slug)
);

CREATE TABLE IF NOT EXISTS ai_profiles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'chat',     -- chat | vision | speech
  provider TEXT NOT NULL DEFAULT 'openai_compatible',
  model TEXT NOT NULL,
  api_base TEXT,
  api_key TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_test_at TEXT,
  last_test_message TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
