/**
 * mobile / desktop の Lighthouse 設定の組み立て。
 */
import type { Strategy } from '../config.js';

export interface MeasureOptions {
  strategy: Strategy;
  /** 追加 HTTP ヘッダー (認証情報を含む) */
  extraHeaders: Record<string, string>;
  /** User-Agent の上書き (未指定なら Lighthouse の既定) */
  userAgent?: string;
  /** タイムアウト (ミリ秒)。maxWaitForLoad に使う */
  timeoutMs: number;
}

export const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'] as const;

export const MOBILE_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Mobile Safari/537.36';

/** lighthouse() に渡す flags を組み立てる。戻り値は設定値のみで、機密情報を含み得る。 */
export function buildFlags(options: MeasureOptions): Record<string, unknown> {
  const flags: Record<string, unknown> = {
    onlyCategories: [...CATEGORIES],
    maxWaitForLoad: options.timeoutMs,
    extraHeaders: options.extraHeaders,
    // 計測結果の HTML レポートは使わない (JSON のみ)
    output: 'json',
  };
  if (options.strategy === 'mobile') {
    flags['formFactor'] = 'mobile';
    flags['screenEmulation'] = {
      mobile: true,
      width: 360,
      height: 640,
      deviceScaleFactor: 2.6,
      disabled: false,
    };
  } else {
    flags['formFactor'] = 'desktop';
    flags['screenEmulation'] = {
      mobile: false,
      width: 1350,
      height: 940,
      deviceScaleFactor: 1,
      disabled: false,
    };
    flags['throttling'] = {
      rttMs: 40,
      throughputKbps: 10240,
      cpuSlowdownMultiplier: 1,
      uploadThroughputKbps: 10240,
    };
  }
  flags['emulatedUserAgent'] =
    options.userAgent ?? (options.strategy === 'mobile' ? MOBILE_USER_AGENT : undefined);
  return flags;
}

/** desktop プリセットを使うかどうか。 */
export function useDesktopPreset(strategy: Strategy): boolean {
  return strategy === 'desktop';
}
