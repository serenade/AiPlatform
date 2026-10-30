export interface DbServerRow {
  id: string;
  tenant_id: string;
  name: string;
  db_type: 'mysql' | 'postgresql';
  host: string;
  port: number;
  username: string;
  password: string;
  ssl: number;
  status: string;
  last_test_at: string | null;
  last_test_message: string | null;
  created_by: string | null;
  created_at: string;
}

/** spec 模型定义（与 AppSpec v0.3 对齐的最小子集） */
export interface SpecField {
  id: string;
  label?: string;
  type: 'text' | 'textarea' | 'number' | 'select' | 'date' | 'checkbox' | 'relation' | 'email' | 'url';
  required?: boolean;
  options?: string[];
  relation?: { targetModelId: string; cardinality?: 'one' | 'many' };
}

export interface SpecModel {
  id: string;
  name: string;
  fields?: SpecField[];
}

export interface AppSpec {
  models?: SpecModel[];
  seeds?: Array<{ modelId: string; rows?: Array<Record<string, unknown>> }>;
  [key: string]: unknown;
}

// ---------- 集成（Builder 集成模块） ----------
export type IntegrationType = 'webhook' | 'api';

export interface SpecIntegration {
  id: string;
  name: string;
  type: IntegrationType;
  url: string;
  /** 缺省：webhook→POST、api→GET */
  method?: string;
  headers?: Record<string, string>;
  /** 缺省 true */
  enabled?: boolean;
}

// ---------- 自动化（Builder 自动化模块） ----------
export type WorkflowTriggerType = 'record_created' | 'record_updated';

export interface SpecWorkflowTrigger {
  type: WorkflowTriggerType;
  modelId: string;
}

export type WorkflowAction =
  | { type: 'webhook'; integrationId: string }
  | { type: 'create_record'; modelId: string; data: Record<string, unknown> };

export interface SpecWorkflow {
  id: string;
  name: string;
  /** 缺省 true */
  enabled?: boolean;
  trigger: SpecWorkflowTrigger;
  actions: WorkflowAction[];
}

// ---------- 权限（Builder 用户与权限模块） ----------
export type PlatformRole = 'owner' | 'admin' | 'member' | 'viewer';
export type DataPermission = 'data:read' | 'data:write' | 'data:delete';

export interface RoleDefinition {
  role: PlatformRole;
  permissions: DataPermission[];
}
