import { randomUUID } from 'node:crypto';

/** 生成平台风格 ID：user_xxx / tenant_xxx / app_xxx / specver_xxx / req_xxx / ses_xxx */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
