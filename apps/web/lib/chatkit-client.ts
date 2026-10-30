/** ChatKit 协议 SSE 客户端（自研 UI，协议与 openai-chatkit 对齐）。 */

export interface ChatEvent {
  type: string;
  [key: string]: unknown;
}

function userInput(text: string) {
  return {
    content: [{ type: 'input_text', text }],
    attachments: [],
    inference_options: {},
  };
}

/** 发送用户消息并消费 SSE 流；每个事件回调一次。 */
export async function chatkitStream(
  appId: string,
  threadId: string | null,
  text: string,
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const body = threadId
    ? { type: 'threads.add_user_message', params: { thread_id: threadId, input: userInput(text) } }
    : { type: 'threads.create', params: { input: userInput(text) } };

  const res = await fetch('/agent/chatkit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-air-app-id': appId },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.json().catch(() => null);
    throw new Error((detail as { detail?: string })?.detail ?? `对话服务错误 (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
          onEvent(JSON.parse(line.slice(6)) as ChatEvent);
        } catch {
          /* 忽略坏帧 */
        }
      }
    }
  }
}

export interface Proposal {
  threadId: string;
  appId: string;
  status: 'pending' | 'applied';
  proposal: {
    summary: string;
    operations: Array<Record<string, any>>;
  };
  errors: string[];
  result: { specVersionId: string; version: number; source: string } | null;
}

export async function fetchProposal(threadId: string): Promise<Proposal | null> {
  const res = await fetch(`/agent/chatkit/threads/${threadId}/proposal`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`获取提案失败 (${res.status})`);
  return res.json();
}

export async function applyProposal(appId: string, threadId: string) {
  const res = await fetch('/agent/chatkit/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, thread_id: threadId }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.errors?.join('；') ?? (data as { error?: string }).error ?? `应用失败 (${res.status})`);
  }
  return data;
}

/** 只读浏览：拉取指定会话的消息记录（按时间正序）。 */
export interface ThreadMessage {
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
}

export async function fetchThreadMessages(threadId: string): Promise<ThreadMessage[]> {
  const res = await fetch(`/agent/chatkit/threads/${encodeURIComponent(threadId)}/items`);
  if (!res.ok) throw new Error(`获取会话记录失败 (${res.status})`);
  const data = (await res.json()) as { items?: Array<Record<string, unknown>> };
  const messages: ThreadMessage[] = [];
  for (const item of data.items ?? []) {
    const type = String(item.type ?? '');
    if (!type.includes('message')) continue;
    const role: ThreadMessage['role'] = type.startsWith('user') ? 'user' : 'assistant';
    const content = Array.isArray(item.content) ? item.content : [];
    const text = content
      .map((p) => (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : ''))
      .join('')
      .trim();
    if (!text) continue;
    messages.push({ role, text, createdAt: String(item._createdAt ?? item.created_at ?? '') });
  }
  return messages;
}
