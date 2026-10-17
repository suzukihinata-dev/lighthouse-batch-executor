/**
 * リトライと待機。
 */
import { MeasurementTimeoutError } from './runner.js';

/** 再試行しても結果が変わらないと考えられる Lighthouse の runtimeError コード。 */
const NON_RETRYABLE_CODES = new Set([
  'NO_FCP', // ページが描画しない (対象外ページの可能性が高い) は再試行の価値が薄い
]);

export interface RetryOptions {
  retries: number;
  /** リトライ間の基本待機ミリ秒 (指数的に 2 倍に増える) */
  baseDelayMs?: number;
  /** リトライ時に呼ばれる (ログ用) */
  onRetry?: (attempt: number, error: Error) => void;
}

export function isRetryable(error: Error): boolean {
  if (error instanceof MeasurementTimeoutError) return true;
  // Chrome との接続系のエラー
  if (
    /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ERR_CONNECTION|ERR_TIMED_OUT|socket hang up/i.test(
      error.message,
    )
  )
    return true;
  // Lighthouse の runtimeError は "CODE: message" 形式で渡ってくる
  const code = /^([A-Z_]+):/.exec(error.message)?.[1];
  if (code && NON_RETRYABLE_CODES.has(code)) return false;
  if (code === 'PROTOCOL_TIMEOUT' || code === 'PAGE_HUNG') return true;
  return false;
}

/** リトライ付きで fn を実行する。fn が Error を投げた場合のみリトライ対象になる。 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const baseDelayMs = options.baseDelayMs ?? 1_000;
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= options.retries; attempt++) {
    if (attempt > 0) {
      const delay = baseDelayMs * 2 ** (attempt - 1);
      await sleep(delay);
    }
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      options.onRetry?.(attempt + 1, lastError);
      if (!isRetryable(lastError)) break;
    }
  }
  throw lastError;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
