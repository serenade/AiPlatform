/** Builder 面板共享的 spec 类型与保存工具：剥离 _meta 后全量 PUT /spec。 */
import { apiFetch } from '@/lib/api';

export interface BuilderSpecField {
  id: string;
  label?: string;
  name?: string;
  type: string;
  required?: boolean;
  options?: string[];
  relation?: { targetModelId: string; cardinality?: 'one' | 'many' };
  [key: string]: unknown;
}

export interface BuilderSpecModel {
  id: string;
  name: string;
  fields?: BuilderSpecField[];
  [key: string]: unknown;
}

export interface SpecIntegration {
  id: string;
  name: string;
  type: 'webhook' | 'api';
  url: string;
  method?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export interface SpecWorkflow {
  id: string;
  name: string;
  enabled?: boolean;
  trigger: { type: 'record_created' | 'record_updated'; modelId: string };
  actions: Array<
    | { type: 'webhook'; integrationId: string }
    | { type: 'create_record'; modelId: string; data: Record<string, unknown> }
  >;
}

export interface RoleDefinition {
  role: 'owner' | 'admin' | 'member' | 'viewer';
  permissions: Array<'data:read' | 'data:write' | 'data:delete'>;
}

export interface BuilderSpec {
  specVersion: string;
  models: BuilderSpecModel[];
  seeds: Array<{ modelId: string; rows: unknown[] }>;
  pages: Array<{ id: string; title: string; type: string; modelId?: string }>;
  navigation: { items: Array<{ id: string; label: string; pageId: string }> };
  integrations?: SpecIntegration[];
  workflows?: SpecWorkflow[];
  policy?: { roleDefinitions?: RoleDefinition[]; [key: string]: unknown };
  _meta?: { version: number; source: string; createdAt: string };
  [key: string]: unknown;
}

/** 生成面板用的短 id（无严格格式要求，仅 spec 内唯一） */
export function panelId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** 全量保存 spec（message 仅作 git 提交说明，服务端会剔除不落库），返回新版本号。 */
export async function saveSpec(appId: string, spec: BuilderSpec, message: string): Promise<{ version: number }> {
  const body: Record<string, unknown> = { ...spec, _meta: undefined, message };
  return apiFetch<{ version: number }>(`/apps/${appId}/spec`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}
