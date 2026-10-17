/**
 * `list` / `show` サブコマンド: 実行の一覧と結果の確認。
 */
import { Command } from 'commander';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCsv } from '../output/csv.js';
import { DEFAULTS } from '../config.js';

interface RunSummary {
  runId: string;
  rows: number;
  ok: number;
  partial: number;
  error: number;
  stateCount: number;
  done: boolean;
}

function summarizeRun(outputDir: string, runId: string): RunSummary {
  const runDir = join(outputDir, runId);
  const table = readCsv(join(runDir, 'results.csv'));
  const statusIdx = table?.header.indexOf('status') ?? -1;
  const counts = { ok: 0, partial: 0, error: 0 };
  for (const row of table?.rows ?? []) {
    const status = statusIdx >= 0 ? row[statusIdx] : undefined;
    if (status === 'ok' || status === 'partial' || status === 'error') counts[status] += 1;
  }
  let stateCount = 0;
  const statePath = join(runDir, 'state.jsonl');
  if (existsSync(statePath)) {
    stateCount = readFileSync(statePath, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '').length;
  }
  // 完了目安: state.jsonl の行数が「URL 数 × strategy 数」に達しているか
  let expected = 0;
  if (existsSync(join(runDir, 'urls.txt'))) {
    const urlCount = readFileSync(join(runDir, 'urls.txt'), 'utf8')
      .split('\n')
      .filter((l) => l !== '').length;
    let strategyCount = 2;
    if (existsSync(join(runDir, 'config.json'))) {
      const echo = JSON.parse(readFileSync(join(runDir, 'config.json'), 'utf8')) as {
        strategy?: string;
      };
      if (echo.strategy === 'mobile' || echo.strategy === 'desktop') strategyCount = 1;
    }
    expected = urlCount * strategyCount;
  }
  return {
    runId,
    rows: table?.rows.length ?? 0,
    ...counts,
    stateCount,
    done: expected > 0 && stateCount >= expected,
  };
}

export function buildListCommand(): Command {
  const cmd = new Command('list')
    .description('出力ディレクトリ内の実行一覧を表示する')
    .option('--output-dir <dir>', '出力ディレクトリのルート', DEFAULTS.outputDir);

  cmd.action(() => {
    const outputDir = cmd.getOptionValue('outputDir') as string;
    if (!existsSync(outputDir)) {
      process.stderr.write(`出力ディレクトリがありません: ${outputDir}\n`);
      process.exitCode = 1;
      return;
    }
    const runIds = readdirSync(outputDir)
      .filter((name) => /^\d{8}-\d{6}$/.test(name))
      .sort();
    if (runIds.length === 0) {
      console.log('実行はありません');
      return;
    }
    console.log('実行ID            行数  ok  partial  error  完了');
    for (const runId of runIds) {
      const s = summarizeRun(outputDir, runId);
      console.log(
        `${s.runId}  ${String(s.rows).padStart(4)}  ${String(s.ok).padStart(2)}  ${String(s.partial).padStart(7)}  ${String(s.error).padStart(5)}  ${s.done ? '済' : '途中'}`,
      );
    }
  });
  return cmd;
}

export function buildShowCommand(): Command {
  const cmd = new Command('show')
    .description('指定した実行の詳細 (設定・結果サマリ・エラー一覧) を表示する')
    .argument('<runId>', '実行 ID (YYYYMMDD-HHmmss)')
    .option('--output-dir <dir>', '出力ディレクトリのルート', DEFAULTS.outputDir)
    .option('--errors <n>', '表示するエラー行の上限', '10');

  cmd.action((runId: string) => {
    const outputDir = cmd.getOptionValue('outputDir') as string;
    const runDir = join(outputDir, runId);
    if (!existsSync(runDir)) {
      process.stderr.write(`実行ディレクトリがありません: ${runDir}\n`);
      process.exitCode = 1;
      return;
    }

    const configJson = join(runDir, 'config.json');
    if (existsSync(configJson)) {
      console.log('--- 設定 ---');
      console.log(readFileSync(configJson, 'utf8').trim());
    }

    const table = readCsv(join(runDir, 'results.csv'));
    if (table === null) {
      console.log('\nresults.csv はまだありません');
      return;
    }
    const idx = (name: string) => table.header.indexOf(name);
    const statusIdx = idx('status');
    const urlIdx = idx('url');
    const strategyIdx = idx('strategy');
    const errorIdx = idx('error_message');
    const counts = { ok: 0, partial: 0, error: 0 };
    const errorRows: string[][] = [];
    for (const row of table.rows) {
      const status = row[statusIdx] ?? '';
      if (status === 'ok' || status === 'partial' || status === 'error') counts[status] += 1;
      if (status === 'error') errorRows.push(row);
    }
    console.log('\n--- 結果 ---');
    console.log(
      `行数: ${table.rows.length} (ok: ${counts.ok}, partial: ${counts.partial}, error: ${counts.error})`,
    );

    if (errorRows.length > 0) {
      const limit = Number(cmd.getOptionValue('errors') ?? 10);
      console.log('\n--- エラー ---');
      for (const row of errorRows.slice(0, limit)) {
        const message = (row[errorIdx] ?? '').slice(0, 100);
        console.log(`${row[strategyIdx]} ${row[urlIdx]}: ${message}`);
      }
      if (errorRows.length > limit) console.log(`... 他 ${errorRows.length - limit} 件`);
    }
  });
  return cmd;
}
