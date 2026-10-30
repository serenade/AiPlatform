/** 平台 API 客户端封装：自动携带 CSRF 头，401 时跳转登录页。 */

export interface RuntimeRequestErrorBody {
  error: string;
  code: string;
  statusCode: number;
  requestId: string;
  message: string;
}

export class ApiError extends Error {
  constructor(public body: RuntimeRequestErrorBody) {
    super(body.message);
  }
}

function csrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  return document.cookie.match(/(?:^|;\s*)air_csrf=([^;]+)/)?.[1] ?? null;
}

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && init.body) headers.set('Content-Type', 'application/json');
  const csrf = csrfToken();
  if (csrf) headers.set('x-csrf-token', csrf);

  const res = await fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin' });

  if (res.status === 401 && !path.startsWith('/auth/login')) {
    if (typeof window !== 'undefined') window.location.href = '/auth/login';
    throw new ApiError({ error: 'RuntimeRequestError', code: 'AUTHENTICATION_REQUIRED', statusCode: 401, requestId: '', message: '请重新登录' });
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      data ?? { error: 'RuntimeRequestError', code: 'INTERNAL_ERROR', statusCode: res.status, requestId: '', message: `请求失败 (${res.status})` },
    );
  }
  return data as T;
}
