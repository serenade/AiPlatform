import { describe, expect, it } from 'vitest';
import { isDraftChanged, isPreviewSearch, resolvePageId } from './preview';

describe('isPreviewSearch', () => {
  it('?preview=1 为预览模式', () => {
    expect(isPreviewSearch('?preview=1')).toBe(true);
  });

  it('与其他参数组合时仍为预览模式', () => {
    expect(isPreviewSearch('?preview=1&foo=bar')).toBe(true);
  });

  it('无参数 / 空搜索串不是预览模式', () => {
    expect(isPreviewSearch('')).toBe(false);
    expect(isPreviewSearch('?')).toBe(false);
    expect(isPreviewSearch('?other=1')).toBe(false);
  });

  it('preview 取值非 1 时不是预览模式', () => {
    expect(isPreviewSearch('?preview=0')).toBe(false);
    expect(isPreviewSearch('?preview=')).toBe(false);
    expect(isPreviewSearch('?preview=true')).toBe(false);
  });
});

describe('isDraftChanged', () => {
  it('版本不同视为变化', () => {
    expect(isDraftChanged('specver_a', 'specver_b')).toBe(true);
  });

  it('首次加载（prev 为 null）视为变化', () => {
    expect(isDraftChanged(null, 'specver_a')).toBe(true);
  });

  it('版本相同视为无变化', () => {
    expect(isDraftChanged('specver_a', 'specver_a')).toBe(false);
  });

  it('next 版本缺失视为变化（异常兜底强制刷新）', () => {
    expect(isDraftChanged('specver_a', null)).toBe(true);
    expect(isDraftChanged(null, null)).toBe(true);
  });
});

describe('resolvePageId', () => {
  const spec = {
    pages: [{ id: 'p_intro' }, { id: 'p_list' }],
    navigation: { items: [{ label: '列表', pageId: 'p_list' }] },
  };

  it('当前页仍存在时保留', () => {
    expect(resolvePageId(spec, 'p_list')).toBe('p_list');
  });

  it('当前页已被删除时回退导航首项', () => {
    expect(resolvePageId(spec, 'p_removed')).toBe('p_list');
  });

  it('无导航项时回退第一个页面', () => {
    expect(resolvePageId({ pages: spec.pages, navigation: { items: [] } }, null)).toBe('p_intro');
  });

  it('无导航且无页面时为 null', () => {
    expect(resolvePageId({ pages: [], navigation: { items: [] } }, null)).toBeNull();
    expect(resolvePageId({}, null)).toBeNull();
  });
});
