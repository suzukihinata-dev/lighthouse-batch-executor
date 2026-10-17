/**
 * URL の正規化 (純粋関数)。
 */

/** フラグメント除去、ホスト名の小文字化、既定ポートの除去、末尾スラッシュの統一。 */
export function normalizeUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if (
    (url.protocol === 'https:' && url.port === '443') ||
    (url.protocol === 'http:' && url.port === '80')
  ) {
    url.port = '';
  }
  // パスの正規化: 空は "/" に、末尾スラッシュは除去 (ルート以外)
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (url.pathname === '') url.pathname = '/';

  // search はそのまま維持する (クエリ付き URL と無しを区別する)
  return url.toString();
}

/** 指定 URL の origin (正規化済みホスト) を返す。 */
export function originOf(input: string): string | null {
  try {
    return new URL(input).origin.toLowerCase();
  } catch {
    return null;
  }
}

/** URL が base と同じホストかどうか。 */
export function isSameHost(url: string, base: string): boolean {
  const a = originOf(url);
  const b = originOf(base);
  return a !== null && a === b;
}
