/**
 * サブコマンド共通のオプション定義とヘルパー。
 */
import { Command, InvalidArgumentError, type Option } from 'commander';
import { DEFAULTS } from '../config.js';
import { parseHeader } from '../config.js';

export function parseIntArg(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0)
    throw new InvalidArgumentError('0 以上の整数を指定してください');
  return n;
}

export function parseHeaderArg(
  value: string,
  previous: Record<string, string>,
): Record<string, string> {
  const [name, headerValue] = parseHeader(value);
  return { ...previous, [name]: headerValue };
}

/** 計測 (run / resume) に共通するオプション。--site は各コマンドで追加する。 */
export function addMeasureOptions(cmd: Command): Command {
  return cmd
    .option('--sitemap <url>', 'sitemap.xml の URL を明示指定')
    .option('--strategy <type>', '計測 strategy (mobile / desktop / both)', 'both')
    .option('--runs <n>', '1 (URL, strategy) あたりの計測回数', parseIntArg, DEFAULTS.runs)
    .option('--concurrency <n>', '並列数', parseIntArg, DEFAULTS.concurrency)
    .option('--retries <n>', 'リトライ回数', parseIntArg, DEFAULTS.retries)
    .option('--delay <ms>', 'URL 間の待機ミリ秒', parseIntArg, DEFAULTS.delayMs)
    .option('--timeout <ms>', '1 計測のタイムアウト (ミリ秒)', parseIntArg, DEFAULTS.timeoutMs)
    .option('--header <header...>', '追加 HTTP ヘッダー ("Name: value")', parseHeaderArg, {})
    .option('--user-agent <ua>', 'User-Agent の上書き')
    .option('--no-raw', '生 JSON の保存を行わない')
    .option('--output <path>', '出力 CSV のパス')
    .option('--bom', 'CSV に BOM を付ける (Excel 対策)', false)
    .option('--allow-external-hosts', 'sitemap 内の外部ホスト URL を計測する', false)
    .option('--output-dir <dir>', '出力ディレクトリのルート', DEFAULTS.outputDir);
}

/** URL 収集 (urls) 用の絞り込みオプション。 */
export function addFilterOptions(cmd: Command): Command {
  return cmd
    .option('--include <pattern...>', '対象に含める URL の glob パターン')
    .option('--exclude <pattern...>', '対象から除外する URL の glob パターン')
    .option('--limit <n>', '計測する最大 URL 数', parseIntArg);
}

/**
 * 既定値ではなく CLI で明示指定されたオプションだけを取り出す。
 * 設定ファイルとの統合 (CLI > ファイル > 既定値) に使う。
 */
export function explicitOptions(cmd: Command): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const option of cmd.options as Option[]) {
    const attr = option.attributeName();
    if (cmd.getOptionValueSource(attr) !== 'default') {
      out[attr] = cmd.getOptionValue(attr);
    }
  }
  return out;
}
