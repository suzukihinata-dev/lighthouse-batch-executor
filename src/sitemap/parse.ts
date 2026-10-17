/**
 * sitemap XML の解析 (純粋関数)。
 */
import { XMLParser } from 'fast-xml-parser';

export interface UrlEntry {
  loc: string;
  lastmod?: string;
}

export interface SitemapIndexEntry {
  loc: string;
  lastmod?: string;
}

export type ParsedSitemap =
  | { type: 'urlset'; urls: UrlEntry[] }
  | { type: 'sitemapindex'; sitemaps: SitemapIndexEntry[] }
  | { type: 'unknown' };

const parser = new XMLParser({
  ignoreAttributes: true,
  // <news:name> などの名前空間付き子要素を loc 抽出のノイズにしない
  removeNSPrefix: true,
});

function toRecordArray(value: unknown): Record<string, unknown>[] {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null);
}

function pickText(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** urlset / sitemapindex を判別して解析する。 */
export function parseSitemap(xml: string): ParsedSitemap {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return { type: 'unknown' };
  }

  const urlset = doc['urlset'];
  if (urlset !== undefined) {
    const urls: UrlEntry[] = [];
    for (const entry of toRecordArray((urlset as Record<string, unknown>)['url'])) {
      const loc = pickText(entry['loc']);
      if (loc === undefined) continue;
      urls.push({ loc: loc.trim(), lastmod: pickText(entry['lastmod']) });
    }
    return { type: 'urlset', urls };
  }

  const index = doc['sitemapindex'];
  if (index !== undefined) {
    const sitemaps: SitemapIndexEntry[] = [];
    for (const entry of toRecordArray((index as Record<string, unknown>)['sitemap'])) {
      const loc = pickText(entry['loc']);
      if (loc === undefined) continue;
      sitemaps.push({ loc: loc.trim(), lastmod: pickText(entry['lastmod']) });
    }
    return { type: 'sitemapindex', sitemaps };
  }

  return { type: 'unknown' };
}

/** robots.txt のテキストから Sitemap: 行を取り出す。 */
export function parseRobotsSitemaps(robotsTxt: string): string[] {
  const urls: string[] = [];
  for (const line of robotsTxt.split(/\r?\n/)) {
    const match = /^\s*sitemap\s*:\s*(\S+)\s*$/i.exec(line);
    if (match) urls.push(match[1]!);
  }
  return urls;
}
