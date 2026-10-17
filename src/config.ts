/**
 * 実行設定の型、既定値、検証。
 */

export type Strategy = 'mobile' | 'desktop';

export const STRATEGIES: readonly Strategy[] = ['mobile', 'desktop'];

export interface AuthConfig {
  /** BASIC_AUTH_USER 環境変数の値 */
  user?: string;
  /** BASIC_AUTH_PASSWORD 環境変数の値 */
  password?: string;
}

export interface RunConfig {
  /** 計測対象サイトのルート URL、または sitemap.xml の URL (urls 指定時は省略可) */
  site?: string;
  /** 事前収集済みの URL 一覧 (resume など。指定時は sitemap 収集をスキップ) */
  urls?: string[];
  /** sitemap の URL を明示指定した場合 */
  sitemap?: string;
  /** 計測対象の strategy 一覧 (既定: both → [mobile, desktop]) */
  strategies: Strategy[];
  /** 1 (URL, strategy) あたりの計測回数 */
  runs: number;
  /** 並列数 */
  concurrency: number;
  /** リトライ回数 */
  retries: number;
  /** URL 間の待機ミリ秒 */
  delayMs: number;
  /** 1 計測のタイムアウト (ミリ秒) */
  timeoutMs: number;
  /** include glob パターン */
  include?: string[];
  /** exclude glob パターン */
  exclude?: string[];
  /** 計測する最大 URL 数 */
  limit?: number;
  /** 追加 HTTP ヘッダー (機密値として扱う) */
  extraHeaders: Record<string, string>;
  /** User-Agent の上書き */
  userAgent?: string;
  /** ベーシック認証 (環境変数から読み込んだもの) */
  auth?: AuthConfig;
  /** 生 JSON の保存を行わない */
  noRaw: boolean;
  /** 出力 CSV のパス */
  output?: string;
  /** CSV に BOM を付ける */
  bom: boolean;
  /** resume 対象の実行 ID (フラグ指定があれば resume 有効) */
  resumeFrom?: string;
  /** sitemap 内の外部ホスト URL を許可する */
  allowExternalHosts: boolean;
  /** 出力ディレクトリのルート */
  outputDir: string;
  /** この実行の ID (YYYYMMDD-HHmmss) */
  runId: string;
}

export const DEFAULTS = {
  runs: 3,
  concurrency: 1,
  retries: 2,
  delayMs: 0,
  timeoutMs: 120_000,
  noRaw: false,
  bom: false,
  allowExternalHosts: false,
  outputDir: 'output',
  /** opportunities_json / diagnostics_json の items 上限 (1 audit あたり) */
  maxItems: 50,
} as const;

export const CSV_SCHEMA_VERSION = 1;

export class ConfigError extends Error {}

export function formatRunId(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}

/** BASIC_AUTH_USER / BASIC_AUTH_PASSWORD 環境変数を読む (片方だけの設定はエラー)。 */
export function readAuthFromEnv(env: NodeJS.ProcessEnv): AuthConfig | undefined {
  const user = env['BASIC_AUTH_USER'];
  const password = env['BASIC_AUTH_PASSWORD'];
  if (user === undefined && password === undefined) return undefined;
  if (user === undefined || password === undefined) {
    throw new ConfigError('BASIC_AUTH_USER と BASIC_AUTH_PASSWORD は両方指定してください');
  }
  return { user, password };
}

/** "Name: value" 形式のヘッダー指定を解析する。 */
export function parseHeader(spec: string): [string, string] {
  const idx = spec.indexOf(':');
  if (idx <= 0) throw new ConfigError(`ヘッダーの書式が不正です: "${spec}" ("Name: value" 形式)`);
  const name = spec.slice(0, idx).trim();
  const value = spec.slice(idx + 1).trim();
  if (!name) throw new ConfigError(`ヘッダー名が空です: "${spec}"`);
  return [name, value];
}

export function validateConfig(config: RunConfig): void {
  if (!config.site && !config.urls) {
    throw new ConfigError('--site (または設定ファイルの site) が必要です');
  }
  if (config.runs < 1) throw new ConfigError('--runs は 1 以上を指定してください');
  if (config.concurrency < 1) throw new ConfigError('--concurrency は 1 以上を指定してください');
  if (config.retries < 0) throw new ConfigError('--retries は 0 以上を指定してください');
  if (config.delayMs < 0) throw new ConfigError('--delay は 0 以上を指定してください');
  if (config.timeoutMs <= 0) throw new ConfigError('--timeout は 1 以上を指定してください');
  if (config.limit !== undefined && config.limit < 1)
    throw new ConfigError('--limit は 1 以上を指定してください');
}
