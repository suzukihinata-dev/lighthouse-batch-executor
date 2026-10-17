/**
 * sitemap の場所を決める (robots.txt の探索を含む)。
 */
import { parseRobotsSitemaps } from './parse.js';

export interface FetchResult {
  ok: boolean;
  status: number;
  body: string;
  /** バイナリが必要な場合 (.xml.gz など) の生レスポンス */
  buffer?: Buffer;
}

export type FetchText = (url: string) => Promise<FetchResult>;

export class SitemapDiscoveryError extends Error {}

function isSitemapUrl(url: string): boolean {
  return /\.xml(\.gz)?(\?.*)?$/i.test(url);
}

async function fetchOrThrow(fetchText: FetchText, url: string): Promise<FetchResult> {
  const result = await fetchText(url);
  if (!result.ok) {
    throw new SitemapDiscoveryError(`${url} の取得に失敗しました (HTTP ${result.status})`);
  }
  return result;
}

/**
 * 指定 URL から sitemap の URL 一覧を決める。
 * - sitemap.xml の URL が指定された場合はそのまま返す
 * - ルート URL の場合は /sitemap.xml を試し、無ければ robots.txt の Sitemap: 行を探す
 */
export async function discoverSitemaps(siteUrl: string, fetchText: FetchText): Promise<string[]> {
  if (isSitemapUrl(siteUrl)) {
    await fetchOrThrow(fetchText, siteUrl);
    return [siteUrl];
  }

  const root = new URL(siteUrl);
  const candidates: string[] = [];

  // 1. /sitemap.xml
  try {
    await fetchOrThrow(fetchText, new URL('/sitemap.xml', root).toString());
    candidates.push(new URL('/sitemap.xml', root).toString());
  } catch {
    // 次へ
  }

  // 2. robots.txt の Sitemap: 行
  try {
    const robots = await fetchOrThrow(fetchText, new URL('/robots.txt', root).toString());
    candidates.push(...parseRobotsSitemaps(robots.body));
  } catch {
    // robots.txt が無い場合も /sitemap.xml の成否だけで判断する
  }

  if (candidates.length === 0) {
    throw new SitemapDiscoveryError(
      `${siteUrl} から sitemap を発見できませんでした ` +
        `(/sitemap.xml と robots.txt の Sitemap: 記述を確認してください)`,
    );
  }
  return candidates;
}
