/**
 * JSON 設定ファイル (--config) の読み込みと、実行設定への統合。
 *
 * 優先順位は「CLI の明示指定 > 設定ファイル > 既定値」。
 * 実行時には各実行ディレクトリへ config.json として (機密値を除いて) 書き戻すため、
 * この形式は resume にもそのまま使える。
 */
import { promises as fs } from 'node:fs';
import {
  ConfigError,
  DEFAULTS,
  formatRunId,
  readAuthFromEnv,
  validateConfig,
  type RunConfig,
  type Strategy,
} from './config.js';

/** 設定ファイル (config.json) の形式。機密情報 (ヘッダー値・認証) は含めない。 */
export interface FileConfig {
  site?: string;
  sitemap?: string;
  strategy?: 'mobile' | 'desktop' | 'both';
  runs?: number;
  concurrency?: number;
  retries?: number;
  /** URL 間の待機ミリ秒 */
  delay?: number;
  /** 1 計測のタイムアウト (ミリ秒) */
  timeout?: number;
  include?: string[];
  exclude?: string[];
  limit?: number;
  userAgent?: string;
  noRaw?: boolean;
  output?: string;
  bom?: boolean;
  allowExternalHosts?: boolean;
  outputDir?: string;
}

const FILE_KEYS: Record<string, 'string' | 'number' | 'boolean' | 'string[]' | 'enum'> = {
  site: 'string',
  sitemap: 'string',
  strategy: 'enum',
  runs: 'number',
  concurrency: 'number',
  retries: 'number',
  delay: 'number',
  timeout: 'number',
  include: 'string[]',
  exclude: 'string[]',
  limit: 'number',
  userAgent: 'string',
  noRaw: 'boolean',
  output: 'string',
  bom: 'boolean',
  allowExternalHosts: 'boolean',
  outputDir: 'string',
};

/** JSON テキストを FileConfig に解析する。未知のキー・不正な型はエラー。 */
export function parseFileConfig(text: string): FileConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(
      `設定ファイルが JSON として解析できません: ${error instanceof Error ? error.message : error}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConfigError('設定ファイルは JSON オブジェクトにしてください');
  }
  const config: FileConfig = {};
  for (const [key, value] of Object.entries(parsed)) {
    const kind = FILE_KEYS[key];
    if (kind === undefined) {
      throw new ConfigError(`設定ファイルに未知のキー "${key}" があります`);
    }
    if (value === null) continue;
    const ok =
      (kind === 'string' && typeof value === 'string') ||
      (kind === 'number' && typeof value === 'number' && Number.isFinite(value)) ||
      (kind === 'boolean' && typeof value === 'boolean') ||
      (kind === 'string[]' && Array.isArray(value) && value.every((v) => typeof v === 'string')) ||
      (kind === 'enum' && (value === 'mobile' || value === 'desktop' || value === 'both'));
    if (!ok) {
      throw new ConfigError(`設定ファイルの "${key}" の型が不正です (${kind} を指定してください)`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 上で型検証済み
    (config as any)[key] = value;
  }
  return config;
}

export async function loadFileConfig(path: string): Promise<FileConfig> {
  return parseFileConfig(await fs.readFile(path, 'utf8'));
}

/** RunConfig を設定ファイル形式へ書き戻す (機密情報は含めない)。 */
export function toFileConfig(config: RunConfig): FileConfig {
  return {
    ...(config.site ? { site: config.site } : {}),
    ...(config.sitemap ? { sitemap: config.sitemap } : {}),
    strategy:
      config.strategies.length === 2
        ? 'both'
        : config.strategies.length === 1
          ? config.strategies[0]
          : undefined,
    runs: config.runs,
    concurrency: config.concurrency,
    retries: config.retries,
    delay: config.delayMs,
    timeout: config.timeoutMs,
    ...(config.include ? { include: config.include } : {}),
    ...(config.exclude ? { exclude: config.exclude } : {}),
    ...(config.limit !== undefined ? { limit: config.limit } : {}),
    ...(config.userAgent ? { userAgent: config.userAgent } : {}),
    noRaw: config.noRaw,
    ...(config.output ? { output: config.output } : {}),
    bom: config.bom,
    allowExternalHosts: config.allowExternalHosts,
    outputDir: config.outputDir,
  };
}

export interface BuildConfigInput {
  /** 設定ファイル (--config または resume 先の config.json) */
  file?: FileConfig;
  /** CLI で明示指定されたオプションのみ (既定値は含めない) */
  cli?: Record<string, unknown>;
  urls?: string[];
  resumeFrom?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}

function pick(cli: Record<string, unknown> | undefined, file: FileConfig | undefined, key: string) {
  if (cli && cli[key] !== undefined) return cli[key];
  const fileValue = file?.[key as keyof FileConfig];
  return fileValue !== undefined ? fileValue : undefined;
}

/** 設定ファイルと CLI 指定を統合して RunConfig を作る。 */
export function buildRunConfig(input: BuildConfigInput): RunConfig {
  const { file, cli = {}, env = process.env } = input;

  const strategyValue = pick(cli, file, 'strategy');
  const strategies: Strategy[] =
    strategyValue === 'mobile' || strategyValue === 'desktop'
      ? [strategyValue]
      : ['mobile', 'desktop'];

  const cliHeaders = (cli['header'] as Record<string, string> | undefined) ?? {};

  const config: RunConfig = {
    site: pick(cli, file, 'site') as string | undefined,
    sitemap: pick(cli, file, 'sitemap') as string | undefined,
    strategies,
    runs: Number(pick(cli, file, 'runs') ?? DEFAULTS.runs),
    concurrency: Number(pick(cli, file, 'concurrency') ?? DEFAULTS.concurrency),
    retries: Number(pick(cli, file, 'retries') ?? DEFAULTS.retries),
    delayMs: Number(pick(cli, file, 'delay') ?? DEFAULTS.delayMs),
    timeoutMs: Number(pick(cli, file, 'timeout') ?? DEFAULTS.timeoutMs),
    include: pick(cli, file, 'include') as string[] | undefined,
    exclude: pick(cli, file, 'exclude') as string[] | undefined,
    limit: pick(cli, file, 'limit') !== undefined ? Number(pick(cli, file, 'limit')) : undefined,
    extraHeaders: cliHeaders,
    userAgent: pick(cli, file, 'userAgent') as string | undefined,
    auth: readAuthFromEnv(env),
    noRaw: cli['raw'] === false || file?.noRaw === true,
    output: pick(cli, file, 'output') as string | undefined,
    bom: Boolean(pick(cli, file, 'bom')),
    resumeFrom: input.resumeFrom,
    allowExternalHosts: Boolean(pick(cli, file, 'allowExternalHosts')),
    outputDir: String(pick(cli, file, 'outputDir') ?? DEFAULTS.outputDir),
    runId: input.resumeFrom ?? formatRunId(input.now),
    ...(input.urls ? { urls: input.urls } : {}),
  };

  // ベーシック認証は extraHeaders へ (環境変数のみから読む。F7-2)
  if (config.auth?.user && config.auth.password) {
    const token = Buffer.from(`${config.auth.user}:${config.auth.password}`).toString('base64');
    config.extraHeaders = { ...config.extraHeaders, Authorization: `Basic ${token}` };
  }
  validateConfig(config);
  return config;
}
