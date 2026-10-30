/**
 * 实时预览模式纯逻辑（AppShell 使用，独立导出便于单元测试）：
 * - isPreviewSearch：根据 location.search 判定是否预览模式（?preview=1）
 * - isDraftChanged：草稿版本变化判定，决定轮询是否刷新
 * - resolvePageId：spec 变更后的页面回退策略（保留当前页，缺失时回退导航首项）
 */

export function isPreviewSearch(search: string): boolean {
  return new URLSearchParams(search).get('preview') === '1';
}

/** nextVer 为空视为变化（异常兜底强制刷新），与 prevVer 相同则跳过。 */
export function isDraftChanged(prevVer: string | null, nextVer: string | null): boolean {
  return !(nextVer && nextVer === prevVer);
}

/** 保留仍存在的当前页，否则回退导航首项 / 首个页面。 */
export function resolvePageId(
  spec: { pages?: Array<{ id: string }>; navigation?: { items?: Array<{ pageId: string }> } },
  prevPageId: string | null,
): string | null {
  if (prevPageId && spec.pages?.some((p) => p.id === prevPageId)) return prevPageId;
  const nav = spec.navigation?.items ?? [];
  return nav[0]?.pageId ?? spec.pages?.[0]?.id ?? null;
}
