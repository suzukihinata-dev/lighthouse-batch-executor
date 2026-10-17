#!/usr/bin/env node
/**
 * CLI 引数の解析と全体の組み立て。
 */
import { Command, InvalidArgumentError } from 'commander';
import { readdirSync } from 'node:fs';
import {
  DEFAULTS,
  CSV_SCHEMA_VERSION,
  formatRunId,
  parseHeader,
  readAuthFromEnv,
  validateConfig,
  type RunConfig,
  type Strategy,
} from './config.js';
import { runPipeline } from './pipeline.js';
import { latestRunId } from './output/state.js';

function parseIntArg(value: string, _previous?: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0)
    throw new InvalidArgumentError('0 以上の整数を指定してください');
  return n;
}

function parseHeaderArg(value: string, previous: Record<string, string>): Record<string, string> {
  const [name, headerValue] = parseHeader(value);
  return { ...previous, [name]: headerValue };
}

export function buildCommand(): Command {
  const program = new Command();
  program
    .name('lighthouse-batch')
    .description('指定サイトの sitemap 内の全 URL に Lighthouse を実行し、CSV へ出力する')
    .requiredOption('--site <url>', 'サイトのルート URL または sitemap.xml の URL')
    .option('--sitemap <url>', 'sitemap.xml の URL を明示指定')
    .option('--strategy <type>', '計測 strategy', 'both')
    .option(
      '--runs <n>',
      '1 (URL, strategy) あたりの計測回数',
      (v: string) => parseIntArg(v),
      DEFAULTS.runs,
    )
    .option('--concurrency <n>', '並列数', (v: string) => parseIntArg(v), DEFAULTS.concurrency)
    .option('--retries <n>', 'リトライ回数', (v: string) => parseIntArg(v), DEFAULTS.retries)
    .option('--delay <ms>', 'URL 間の待機ミリ秒', (v: string) => parseIntArg(v), DEFAULTS.delayMs)
    .option(
      '--timeout <ms>',
      '1 計測のタイムアウト (ミリ秒)',
      (v: string) => parseIntArg(v),
      DEFAULTS.timeoutMs,
    )
    .option('--include <pattern...>', '対象に含める URL の glob パターン')
    .option('--exclude <pattern...>', '対象から除外する URL の glob パターン')
    .option('--limit <n>', '計測する最大 URL 数', (v) => parseIntArg(v))
    .option('--header <header...>', '追加 HTTP ヘッダー ("Name: value")', parseHeaderArg, {})
    .option('--user-agent <ua>', 'User-Agent の上書き')
    .option('--no-raw', '生 JSON の保存を行わない')
    .option('--output <path>', '出力 CSV のパス')
    .option('--bom', 'CSV に BOM を付ける (Excel 対策)', false)
    .option('--resume [runId]', '中断した実行を再開 (実行 ID 省略時は最新)')
    .option('--allow-external-hosts', 'sitemap 内の外部ホスト URL を計測する', false)
    .option('--output-dir <dir>', '出力ディレクトリのルート', DEFAULTS.outputDir)
    .version(CSV_SCHEMA_VERSION === 1 ? '0.1.0' : '0.1.0');
  return program;
}

export function configFromOptions(
  options: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): RunConfig {
  const strategyValue = String(options['strategy'] ?? 'both');
  const strategies: Strategy[] =
    strategyValue === 'both' ? ['mobile', 'desktop'] : [strategyValue as Strategy];

  let resumeFrom: string | undefined;
  if (options['resume'] !== undefined) {
    const specified = options['resume'];
    if (typeof specified === 'string' && specified !== '') {
      resumeFrom = specified;
    } else {
      const latest = latestRunId(
        (dir) => readdirSync(dir),
        String(options['outputDir'] ?? DEFAULTS.outputDir),
      );
      if (latest === null) {
        throw new Error('resume 先の実行が見つかりません (--resume <実行ID> を指定してください)');
      }
      resumeFrom = latest;
    }
  }

  const config: RunConfig = {
    site: String(options['site']),
    sitemap: options['sitemap'] ? String(options['sitemap']) : undefined,
    strategies,
    runs: Number(options['runs'] ?? DEFAULTS.runs),
    concurrency: Number(options['concurrency'] ?? DEFAULTS.concurrency),
    retries: Number(options['retries'] ?? DEFAULTS.retries),
    delayMs: Number(options['delay'] ?? DEFAULTS.delayMs),
    timeoutMs: Number(options['timeout'] ?? DEFAULTS.timeoutMs),
    include: options['include'] as string[] | undefined,
    exclude: options['exclude'] as string[] | undefined,
    limit: options['limit'] !== undefined ? Number(options['limit']) : undefined,
    extraHeaders: (options['header'] as Record<string, string>) ?? {},
    userAgent: options['userAgent'] ? String(options['userAgent']) : undefined,
    auth: readAuthFromEnv(env),
    noRaw: options['raw'] === false,
    output: options['output'] ? String(options['output']) : undefined,
    bom: Boolean(options['bom']),
    resumeFrom,
    allowExternalHosts: Boolean(options['allowExternalHosts']),
    outputDir: String(options['outputDir'] ?? DEFAULTS.outputDir),
    runId: resumeFrom ?? formatRunId(),
  };

  // ベーシック認証は extraHeaders へ (環境変数のみから読む。F7-2)
  if (config.auth?.user && config.auth.password) {
    const token = Buffer.from(`${config.auth.user}:${config.auth.password}`).toString('base64');
    config.extraHeaders = { ...config.extraHeaders, Authorization: `Basic ${token}` };
  }
  validateConfig(config);
  return config;
}

export async function main(argv: string[]): Promise<void> {
  const program = buildCommand();
  program.parse(argv);
  const options = program.opts<Record<string, unknown>>();
  let config: RunConfig;
  try {
    config = configFromOptions(options);
  } catch (error) {
    process.stderr.write(`設定エラー: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
    return;
  }
  try {
    await runPipeline(config);
  } catch (error) {
    process.stderr.write(`エラー: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  void main(process.argv);
}
