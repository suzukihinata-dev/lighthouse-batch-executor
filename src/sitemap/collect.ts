/**
 * sitemap index の再帰解決、重複除去。
 */
import { gunzipSync } from 'node:zlib';
import { parseSitemap } from './parse.js';
import { discoverSitemaps, type FetchText } from './discover.js';
import { normalizeUrl, isSameHost } from '../url/normalize.js';

export interface CollectOptions {
  /** index の再帰深さの上限 */
  maxDepth?: number;
  /** sitemap 内の外部ホスト URL を許可する */
  allowExternalHosts?: boolean;
}

export interface CollectedUrls {
  urls: string[];
  /** 外部ホストのため除外された URL */
  externalSkipped: string[];
}

export class SitemapCollectError extends Error {}

function gunzipIfGz(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    return gunzipSync(buffer).toString('utf8');
  }
  return buffer.toString('utf8');
}

export type KnownSitemap = Exclude<ReturnType<typeof parseSitemap>, { type: 'unknown' }>;

/** 1 つの sitemap を取得して解析する (.xml.gz 対応)。 */
export async function fetchSitemap(url: string, fetchText: FetchText): Promise<KnownSitemap> {
  const result = await fetchText(url);
  if (!result.ok) {
    throw new SitemapCollectError(`sitemap の取得に失敗しました: ${url} (HTTP ${result.status})`);
  }
  const xml = /\.gz(\?.*)?$/i.test(url) && result.buffer ? gunzipIfGz(result.buffer) : result.body;
  const parsed = parseSitemap(xml);
  if (parsed.type === 'unknown') {
    throw new SitemapCollectError(`sitemap として解析できませんでした: ${url}`);
  }
  return parsed;
}

/**
 * sitemap (index 含む) から URL を収集する。
 * 循環参照防止のため訪問済み sitemap を管理し、深さ上限を超えたら警告付きで打ち切る。
 */
export async function collectUrls(
  entryUrl: string,
  fetchText: FetchText,
  options: CollectOptions = {},
): Promise<CollectedUrls> {
  const maxDepth = options.maxDepth ?? 5;
  const seenSitemaps = new Set<string>();
  const urlSet = new Set<string>();
  const externalSkipped: string[] = [];
  let depthWarning: string | null = null;

  const roots = await discoverSitemaps(entryUrl, fetchText);

  async function walk(sitemapUrl: string, depth: number): Promise<void> {
    if (seenSitemaps.has(sitemapUrl)) return;
    seenSitemaps.add(sitemapUrl);
    if (depth > maxDepth) {
      depthWarning = `sitemap index が深さ ${maxDepth} を超えたため打ち切りました: ${sitemapUrl}`;
      return;
    }
    const parsed = await fetchSitemap(sitemapUrl, fetchText);
    if (parsed.type === 'sitemapindex') {
      for (const child of parsed.sitemaps) {
        await walk(child.loc, depth + 1);
      }
      return;
    }
    for (const entry of parsed.urls) {
      const normalized = normalizeUrl(entry.loc);
      if (normalized === null) continue;
      if (!options.allowExternalHosts && !isSameHost(normalized, entryUrl)) {
        externalSkipped.push(normalized);
        continue;
      }
      urlSet.add(normalized);
    }
  }

  for (const root of roots) {
    await walk(root, 0);
  }
  if (depthWarning) {
    process.stderr.write(`警告: ${depthWarning}\n`);
  }
  return { urls: [...urlSet], externalSkipped };
}
