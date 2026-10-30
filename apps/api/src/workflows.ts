/**
 * 应用自动化引擎：/api/apps/:appId/workflows/*
 * workflow 配置存 spec.workflows（PUT /spec 保存）；本文件提供：
 *  - 运行时触发入口 runWorkflowsForEvent（data-routes 在记录创建/更新后 fire-and-forget 调用）
 *  - 手动运行路由 POST /:id/run（同步返回每步结果）
 * 防死循环三层：级联 depth 上限、每应用滑动窗口限流、引擎整体吞错只记日志。
 */
import { Router } from 'express';
import type { Request } from 'express';
import { db } from './db.js';
import { RuntimeRequestError, ah } from './errors.js';
import { requireSession } from './auth.js';
import { loadAppSpec, resolveBackend } from './appdata.js';
import { callIntegration } from './integrations.js';
import type { SpecIntegration, SpecWorkflow, WorkflowAction, WorkflowTriggerType } from './dbtypes.js';

export const workflowsRouter = Router({ mergeParams: true });
workflowsRouter.use(requireSession);

interface LooseRequest {
  params: { [key: string]: string | undefined };
  sessionCtx?: { tenantId: string; role: string };
}

function requireApp(req: LooseRequest) {
  const tenantId = req.sessionCtx?.tenantId ?? '';
  const role = req.sessionCtx?.role ?? '';
  const app = db.prepare('SELECT id FROM apps WHERE id = ? AND tenant_id = ?').get(req.params.appId, tenantId) as
    | { id: string }
    | undefined;
  const found =
    app ??
    (role === 'system'
      ? (db.prepare('SELECT id FROM apps WHERE id = ?').get(req.params.appId) as { id: string } | undefined)
      : undefined);
  if (!found) throw RuntimeRequestError.notFound('应用不存在');
}

export interface WorkflowEvent {
  type: WorkflowTriggerType;
  modelId: string;
  record: Record<string, unknown>;
}

export interface ActionResult {
  actionIndex: number;
  type: string;
  ok: boolean;
  detail: string;
}

const MAX_DEPTH = 3;
const WINDOW_MS = 30_000;
const WINDOW_LIMIT = 20;

// 每应用触发时间戳滑动窗口（防风暴）
const fireLog = new Map<string, number[]>();

function rateLimited(appId: string): boolean {
  const nowTs = Date.now();
  const arr = (fireLog.get(appId) ?? []).filter((ts) => nowTs - ts < WINDOW_MS);
  arr.push(nowTs);
  fireLog.set(appId, arr);
  return arr.length > WINDOW_LIMIT;
}

/** 对 action.data 字符串值做 {{record.字段id}} 简单插值，无匹配保留原文。 */
function interpolate(data: Record<string, unknown>, record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') {
      out[k] = v.replace(/\{\{record\.([\w-]+)\}\}/g, (_, fid: string) => {
        const val = record[fid];
        return val === undefined || val === null ? '' : String(val);
      });
    } else {
      out[k] = v;
    }
  }
  return out;
}

function listWorkflows(appId: string): SpecWorkflow[] {
  const spec = loadAppSpec(appId);
  return (Array.isArray(spec.workflows) ? spec.workflows : []) as SpecWorkflow[];
}

function listIntegrations(appId: string): SpecIntegration[] {
  const spec = loadAppSpec(appId);
  return (Array.isArray(spec.integrations) ? spec.integrations : []) as SpecIntegration[];
}

/** 同步执行单个 workflow，返回每步结果（手动 run 使用；级联事件走 fire-and-forget）。 */
async function executeWorkflow(
  appId: string,
  wf: SpecWorkflow,
  event: WorkflowEvent,
  depth: number,
): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  const integrations = listIntegrations(appId);
  for (let i = 0; i < (wf.actions ?? []).length; i++) {
    const action = wf.actions[i] as WorkflowAction;
    try {
      if (action.type === 'webhook') {
        const int = integrations.find((x) => x && x.id === action.integrationId);
        if (!int) {
          results.push({ actionIndex: i, type: 'webhook', ok: false, detail: `集成不存在: ${action.integrationId}` });
          continue;
        }
        if (int.enabled === false) {
          results.push({ actionIndex: i, type: 'webhook', ok: false, detail: `集成已禁用: ${int.name}` });
          continue;
        }
        const r = await callIntegration(int, {
          event: event.type,
          modelId: event.modelId,
          record: event.record,
          workflow: wf.id,
        });
        results.push({ actionIndex: i, type: 'webhook', ok: r.ok, detail: `${r.message}${r.status ? ` (${r.status})` : ''}` });
      } else if (action.type === 'create_record') {
        const backend = await resolveBackend(appId);
        try {
          const model = (loadAppSpec(appId).models ?? []).find((m) => m.id === action.modelId);
          if (!model) {
            results.push({ actionIndex: i, type: 'create_record', ok: false, detail: `目标模型不存在: ${action.modelId}` });
            continue;
          }
          await backend.ensureTable(model);
          const row = await backend.create(model, interpolate(action.data ?? {}, event.record));
          results.push({ actionIndex: i, type: 'create_record', ok: true, detail: `已创建记录 ${row.id}` });
          // 级联触发目标模型的 record_created 事件（受 depth 限制）
          if (depth + 1 < MAX_DEPTH) {
            void fireWorkflows(
              appId,
              { type: 'record_created', modelId: action.modelId, record: { id: row.id, ...Object.fromEntries((model.fields ?? []).map((f) => [f.id, row[`c_${f.id}`]])) } },
              depth + 1,
            );
          } else {
            console.warn(`[workflows] app=${appId} 级联深度已达上限 ${MAX_DEPTH}，跳过后续触发`);
          }
        } finally {
          await backend.dispose();
        }
      } else {
        results.push({
          actionIndex: i,
          type: String((action as { type?: unknown }).type ?? 'unknown'),
          ok: false,
          detail: '未知动作类型',
        });
      }
    } catch (err) {
      results.push({ actionIndex: i, type: String(action.type), ok: false, detail: (err as Error).message });
    }
  }
  return results;
}

/** fire-and-forget 触发：匹配事件的 workflow 全部执行，错误吞掉只记日志，绝不抛出。 */
async function fireWorkflows(appId: string, event: WorkflowEvent, depth: number): Promise<void> {
  try {
    if (rateLimited(appId)) {
      console.warn(`[workflows] app=${appId} ${WINDOW_MS / 1000}s 窗口触发超过 ${WINDOW_LIMIT} 次，跳过本次`);
      return;
    }
    const matches = listWorkflows(appId).filter(
      (wf) => wf && wf.enabled !== false && wf.trigger?.type === event.type && wf.trigger?.modelId === event.modelId,
    );
    for (const wf of matches) {
      const results = await executeWorkflow(appId, wf, event, depth);
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) console.warn(`[workflows] app=${appId} wf=${wf.id} 部分动作失败:`, failed);
    }
  } catch (err) {
    console.error(`[workflows] app=${appId} 事件 ${event.type}/${event.modelId} 处理失败:`, err);
  }
}

/** 数据层事件入口（data-routes 调用）：fire-and-forget，同步返回不阻塞主请求。 */
export function runWorkflowsForEvent(appId: string, event: WorkflowEvent): void {
  void fireWorkflows(appId, event, 0);
}

// ---------- 手动运行 ----------
workflowsRouter.post(
  '/:id/run',
  ah(async (req, res) => {
    requireApp(req);
    const wf = listWorkflows(req.params.appId!).find((w) => w && w.id === req.params.id);
    if (!wf) throw RuntimeRequestError.notFound(`自动化流程不存在: ${req.params.id}`);
    const trigger = wf.trigger ?? { type: 'record_created', modelId: '' };
    const model = (loadAppSpec(req.params.appId!).models ?? []).find((m) => m.id === trigger.modelId);
    const sample: Record<string, unknown> = {};
    if (model) for (const f of model.fields ?? []) sample[f.id] = f.type === 'checkbox' ? true : f.type === 'number' ? 1 : `示例${f.label ?? f.id}`;
    const started = Date.now();
    const results = await executeWorkflow(req.params.appId!, wf, { type: trigger.type, modelId: trigger.modelId, record: sample }, 0);
    const ok = results.every((r) => r.ok);
    res.json({ ok, results, durationMs: Date.now() - started });
  }),
);
