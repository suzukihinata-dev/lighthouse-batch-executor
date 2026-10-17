/**
 * Chrome の起動、1 回の計測、終了。
 */
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';
import type { Lhr } from './types.js';
import { buildFlags, useDesktopPreset, type MeasureOptions } from './options.js';

export class MeasurementTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`計測がタイムアウトしました (${timeoutMs}ms): ${url}`);
    this.name = 'MeasurementTimeoutError';
  }
}

export interface SingleRunResult {
  lhr: Lhr;
}

/**
 * 1 計測を実行する。1 計測ごとに Chrome を新規起動し、終了時に必ず kill する。
 * 外側のタイマーで打ち切った場合は Chrome を強制終了して MeasurementTimeoutError を投げる。
 */
export async function runOnce(url: string, options: MeasureOptions): Promise<SingleRunResult> {
  const flags = buildFlags(options);
  const config = useDesktopPreset(options.strategy) ? desktopConfig : undefined;

  const chrome = await launch({
    chromeFlags: ['--headless', '--disable-gpu', '--no-sandbox'],
  });

  const outerTimer: Promise<never> = new Promise((_resolve, reject) => {
    // maxWaitForLoad の 1.5 倍 + 30 秒を外側の上限とする (内側で止まらない場合の保険)
    const outerLimitMs = Math.max(options.timeoutMs * 1.5, options.timeoutMs + 30_000);
    setTimeout(() => {
      reject(new MeasurementTimeoutError(url, outerLimitMs));
    }, outerLimitMs).unref();
  });

  try {
    const result = (await Promise.race([
      lighthouse(url, { ...flags, port: chrome.port }, config),
      outerTimer,
    ])) as { lhr: Lhr };
    return { lhr: result.lhr };
  } finally {
    // 外側タイマーで打ち切った場合も含め、必ず Chrome を終了する
    try {
      chrome.kill();
    } catch {
      // kill 失敗は無視する (次の計測は別ポートの別プロセスで起動する)
    }
  }
}

/** LHR に runtimeError があればエラーとして扱う。 */
export function runtimeErrorMessage(lhr: Lhr): string | undefined {
  const err = lhr.runtimeError;
  if (err && err.code && err.code !== 'NO_ERROR') {
    return `${err.code}: ${err.message ?? ''}`.trim();
  }
  return undefined;
}
