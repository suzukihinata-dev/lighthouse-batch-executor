/**
 * include / exclude / limit による URL の絞り込み (純粋関数)。
 */
import picomatch from 'picomatch';

export interface FilterOptions {
  /** 一致すれば対象に含める glob。未指定は全て対象。複数指定は OR。 */
  include?: string[];
  /** 一致すれば除外する glob。複数指定は OR。include より優先。 */
  exclude?: string[];
  /** 上限件数 (適用は最後)。 */
  limit?: number;
}

function makeMatcher(patterns: string[] | undefined) {
  if (!patterns || patterns.length === 0) return null;
  const isMatch = picomatch(patterns, { dot: true });
  // パスだけでなく URL 全体にも一致させられるように両方試す
  return (url: string, pathname: string) => isMatch(pathname) || isMatch(url);
}

/** 並び順を保ったまま絞り込む。 */
export function filterUrls(urls: string[], options: FilterOptions): string[] {
  const include = makeMatcher(options.include);
  const exclude = makeMatcher(options.exclude);

  const filtered = urls.filter((url) => {
    let pathname = url;
    try {
      pathname = new URL(url).pathname;
    } catch {
      // 正規化済みのはずだが、壊れた URL は対象外にする
      return false;
    }
    if (exclude?.(url, pathname)) return false;
    if (include && !include(url, pathname)) return false;
    return true;
  });

  if (options.limit !== undefined) return filtered.slice(0, options.limit);
  return filtered;
}
