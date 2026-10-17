import { describe, expect, it } from 'vitest';
import { parseRobotsSitemaps, parseSitemap } from '../../src/sitemap/parse.js';
import { collectUrls } from '../../src/sitemap/collect.js';
import { discoverSitemaps } from '../../src/sitemap/discover.js';
import type { FetchText } from '../../src/sitemap/discover.js';

const URLSET_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc><lastmod>2026-01-01</lastmod></url>
  <url><loc>https://example.com/page-a</loc></url>
  <url><loc>https://example.com/page-b</loc></url>
</urlset>`;

const INDEX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemap-a.xml</loc></sitemap>
  <sitemap><loc>https://example.com/sitemap-b.xml</loc></sitemap>
</sitemapindex>`;

describe('parseSitemap', () => {
  it('urlset を解析する', () => {
    const result = parseSitemap(URLSET_XML);
    expect(result).toEqual({
      type: 'urlset',
      urls: [
        { loc: 'https://example.com/', lastmod: '2026-01-01' },
        { loc: 'https://example.com/page-a', lastmod: undefined },
        { loc: 'https://example.com/page-b', lastmod: undefined },
      ],
    });
  });

  it('sitemapindex を解析する', () => {
    const result = parseSitemap(INDEX_XML);
    expect(result.type).toBe('sitemapindex');
    if (result.type === 'sitemapindex') {
      expect(result.sitemaps.map((s) => s.loc)).toEqual([
        'https://example.com/sitemap-a.xml',
        'https://example.com/sitemap-b.xml',
      ]);
    }
  });

  it('XML でなければ unknown を返す', () => {
    expect(parseSitemap('<html><body>not a sitemap</body></html>').type).toBe('unknown');
    expect(parseSitemap('!!!broken').type).toBe('unknown');
  });

  it('名前空間付き sitemap を解析する', () => {
    const xml = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
      xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
      <url><loc>https://example.com/news/1</loc></url>
    </urlset>`;
    const result = parseSitemap(xml);
    expect(result.type).toBe('urlset');
    if (result.type === 'urlset') expect(result.urls).toHaveLength(1);
  });
});

describe('parseRobotsSitemaps', () => {
  it('Sitemap: 行を取り出す', () => {
    const robots = `User-agent: *
Disallow: /private

Sitemap: https://example.com/sitemap.xml
sitemap: https://example.com/sitemap-2.xml
`;
    expect(parseRobotsSitemaps(robots)).toEqual([
      'https://example.com/sitemap.xml',
      'https://example.com/sitemap-2.xml',
    ]);
  });
});

describe('discoverSitemaps', () => {
  it('sitemap.xml の URL はそのまま使う', async () => {
    const fetchText: FetchText = async () => ({ ok: true, status: 200, body: URLSET_XML });
    const result = await discoverSitemaps('https://example.com/sitemap.xml', fetchText);
    expect(result).toEqual(['https://example.com/sitemap.xml']);
  });

  it('ルート URL は /sitemap.xml を試す', async () => {
    const fetchText: FetchText = async (url) => ({
      ok: url.endsWith('sitemap.xml'),
      status: url.endsWith('sitemap.xml') ? 200 : 404,
      body: URLSET_XML,
    });
    const result = await discoverSitemaps('https://example.com/', fetchText);
    expect(result).toEqual(['https://example.com/sitemap.xml']);
  });

  it('/sitemap.xml が無ければ robots.txt の Sitemap: を使う', async () => {
    const fetchText: FetchText = async (url) => {
      if (url.endsWith('robots.txt')) {
        return { ok: true, status: 200, body: 'Sitemap: https://example.com/index.xml\n' };
      }
      return { ok: false, status: 404, body: '' };
    };
    const result = await discoverSitemaps('https://example.com', fetchText);
    expect(result).toEqual(['https://example.com/index.xml']);
  });

  it('発見できなければエラー', async () => {
    const fetchText: FetchText = async () => ({ ok: false, status: 404, body: '' });
    await expect(discoverSitemaps('https://example.com', fetchText)).rejects.toThrow(/sitemap/);
  });
});

describe('collectUrls', () => {
  it('index を再帰的に解決し、重複を除去する', async () => {
    const fetchText: FetchText = async (url) => {
      if (url === 'https://example.com/index.xml')
        return { ok: true, status: 200, body: INDEX_XML };
      if (url.endsWith('sitemap-a.xml')) return { ok: true, status: 200, body: URLSET_XML };
      if (url.endsWith('sitemap-b.xml')) {
        return {
          ok: true,
          status: 200,
          body: `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            <url><loc>https://example.com/page-a</loc></url>
            <url><loc>https://example.com/page-c/</loc></url>
          </urlset>`,
        };
      }
      return { ok: false, status: 404, body: '' };
    };
    const result = await collectUrls('https://example.com/index.xml', fetchText);
    expect(result.urls.sort()).toEqual([
      'https://example.com/',
      'https://example.com/page-a',
      'https://example.com/page-b',
      'https://example.com/page-c',
    ]);
  });

  it('循環参照を防止する (訪問済みの管理)', async () => {
    const indexA = `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <sitemap><loc>https://example.com/index-b.xml</loc></sitemap>
    </sitemapindex>`;
    const indexB = `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <sitemap><loc>https://example.com/index-a.xml</loc></sitemap>
    </sitemapindex>`;
    const fetchText: FetchText = async (url) => {
      if (url.endsWith('index-b.xml')) return { ok: true, status: 200, body: indexB };
      if (url.endsWith('index-a.xml')) return { ok: true, status: 200, body: indexA };
      return { ok: false, status: 404, body: '' };
    };
    // 循環だけでは URL が 0 件になる (無限ループしないことの確認)
    const result = await collectUrls('https://example.com/index-a.xml', fetchText);
    expect(result.urls).toEqual([]);
  });

  it('外部ホストの URL は既定で除外する', async () => {
    const xml = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://example.com/ok</loc></url>
      <url><loc>https://staging.example.net/ng</loc></url>
    </urlset>`;
    const fetchText: FetchText = async (url) =>
      url.endsWith('sitemap.xml')
        ? { ok: true, status: 200, body: xml }
        : { ok: false, status: 404, body: '' };
    const result = await collectUrls('https://example.com/sitemap.xml', fetchText);
    expect(result.urls).toEqual(['https://example.com/ok']);
    expect(result.externalSkipped).toEqual(['https://staging.example.net/ng']);
  });
});
