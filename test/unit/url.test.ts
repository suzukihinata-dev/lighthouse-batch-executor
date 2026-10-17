import { describe, expect, it } from 'vitest';
import { normalizeUrl, isSameHost } from '../../src/url/normalize.js';
import { filterUrls } from '../../src/url/filter.js';

describe('normalizeUrl', () => {
  it('フラグメントを除去する', () => {
    expect(normalizeUrl('https://example.com/page#section')).toBe('https://example.com/page');
  });

  it('ホスト名を小文字化する', () => {
    expect(normalizeUrl('https://EXAMPLE.com/Page')).toBe('https://example.com/Page');
  });

  it('既定ポートを除去する', () => {
    expect(normalizeUrl('https://example.com:443/page')).toBe('https://example.com/page');
    expect(normalizeUrl('http://example.com:80/page')).toBe('http://example.com/page');
  });

  it('末尾スラッシュを統一する (ルート以外は除去)', () => {
    expect(normalizeUrl('https://example.com/page/')).toBe('https://example.com/page');
    expect(normalizeUrl('https://example.com')).toBe('https://example.com/');
  });

  it('末尾スラッシュの違いだけの URL を同一視する (重複除去用)', () => {
    expect(normalizeUrl('https://example.com/page')).toBe(
      normalizeUrl('https://example.com/page/'),
    );
  });

  it('不正な URL は null', () => {
    expect(normalizeUrl('not a url')).toBeNull();
    expect(normalizeUrl('ftp://example.com/x')).toBeNull();
  });
});

describe('isSameHost', () => {
  it('同一ホストを判定する', () => {
    expect(isSameHost('https://example.com/a', 'https://example.com/b')).toBe(true);
    expect(isSameHost('https://other.com/a', 'https://example.com/b')).toBe(false);
  });
});

describe('filterUrls', () => {
  const urls = [
    'https://example.com/',
    'https://example.com/products/1',
    'https://example.com/products/2',
    'https://example.com/blog/post-a',
    'https://example.com/private/admin',
  ];

  it('include glob で絞り込む', () => {
    expect(filterUrls(urls, { include: ['/products/*'] })).toEqual([
      'https://example.com/products/1',
      'https://example.com/products/2',
    ]);
  });

  it('exclude glob で除外する', () => {
    expect(filterUrls(urls, { exclude: ['/private/*'] })).toHaveLength(4);
  });

  it('exclude は include より優先する', () => {
    expect(
      filterUrls(urls, { include: ['/products/*', '/private/*'], exclude: ['/private/*'] }),
    ).toEqual(['https://example.com/products/1', 'https://example.com/products/2']);
  });

  it('limit で先頭から切り詰める', () => {
    expect(filterUrls(urls, { limit: 2 })).toEqual(urls.slice(0, 2));
  });

  it('URL 全体に対するパターンも一致する', () => {
    expect(filterUrls(urls, { include: ['https://example.com/blog/*'] })).toEqual([
      'https://example.com/blog/post-a',
    ]);
  });
});
