/**
 * 収集 → 計測 → 集約 → 出力の流れ。
 */
import { promises as fs } from 'node:fs';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pLimit from 'p-limit';
import { type RunConfig, type Strategy } from './config.js';
import { toFileConfig } from './config-file.js';
import { collectUrls } from './sitemap/collect.js';
import type { FetchResult, FetchText } from './sitemap/discover.js';
import { filterUrls } from './url/filter.js';
import { runOnce, runtimeErrorMessage } from './lighthouse/runner.js';
import { sleep, withRetry } from './lighthouse/retry.js';
import { extractRun, type RunData } from './aggregate/extract.js';
import {
  aggregateError,
  aggregateRuns,
  pickRepresentativeRun,
  type AggregatedResult,
} from './aggregate/median.js';
import {
  buildColumnDefinition,
  buildRowValues,
  fixedOnlyColumnDefinition,
  loadColumnDefinition,
  saveColumnDefinition,
  type ColumnDefinition,
} from './output/columns.js';
import { CsvWriter, parseCsvLine } from './output/csv.js';
import { RawStore } from './output/raw.js';
import { StateStore, stateKey } from './output/state.js';
import { Logger } from './logger.js';
import { ProgressReporter } from './progress.js';

/** 既定の HTTP 取得 (Node 標準 fetch)。.gz の場合は buffer を渡す。 */
export const defaultFetchText: FetchText = async (url: string): Promise<FetchResult> => {
  const res = await fetch(url, {
    headers: { 'user-agent': 'lighthouse-batch-executor (sitemap collector)' },
    redirect: 'follow',
  });
  if (!res.ok) return { ok: false, status: res.status, body: '' };
  const buffer = Buffer.from(await res.arrayBuffer());
  return { ok: true, status: res.status, body: buffer.toString('utf8'), buffer };
};

/** resume 時に、state.jsonl に記録されていない行を results.csv から除去する (5.4)。 */
function dedupeResultsCsv(csvPath: string, done: Set<string>): void {
  if (!existsSync(csvPath)) return;
  const content = readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
  const lines = content.split('\n').filter((l) => l !== '');
  if (lines.length === 0) return;
  const header = parseCsvLine(lines[0]!);
  const urlIdx = header.indexOf('url');
  const strategyIdx = header.indexOf('strategy');
  if (urlIdx < 0 || strategyIdx < 0) return;
  const kept = [lines[0]!];
  for (const line of lines.slice(1)) {
    const fields = parseCsvLine(line);
    const key = stateKey(fields[urlIdx] ?? '', fields[strategyIdx] ?? '');
    if (done.has(key)) kept.push(line);
  }
  writeFileSync(csvPath, kept.join('\n') + '\n', 'utf8');
}

export interface PipelineResult {
  urls: number;
  tasks: number;
  skipped: number;
}

export async function runPipeline(
  config: RunConfig,
  fetchText: FetchText = defaultFetchText,
): Promise<PipelineResult> {
  const runDir = join(config.outputDir, config.runId);
  await fs.mkdir(runDir, { recursive: true });

  const secrets = [
    config.auth?.password,
    config.auth?.user,
    ...Object.values(config.extraHeaders),
    config.userAgent,
  ];
  const logger = new Logger(join(runDir, 'run.log'), secrets);

  // ---- F1: URL 収集 ----
  let urls: string[];
  if (config.urls) {
    // 事前収集済み (resume や urls.txt 流用) の場合は sitemap 収集をスキップする
    urls = config.urls;
    process.stderr.write(`URL 一覧 (指定済み): ${urls.length} 件\n`);
  } else {
    const collected = await collectUrls(config.sitemap ?? config.site!, fetchText, {
      allowExternalHosts: config.allowExternalHosts,
    });
    if (collected.externalSkipped.length > 0) {
      const note = `外部ホストのため除外: ${collected.externalSkipped.length} 件 (--allow-external-hosts で計測可能)`;
      process.stderr.write(`警告: ${note}\n`);
      logger.log(note);
    }
    urls = filterUrls(collected.urls, {
      include: config.include,
      exclude: config.exclude,
      limit: config.limit,
    });
    process.stderr.write(
      `URL 収集: ${collected.urls.length} 件 (重複除去後)、絞り込み後 ${urls.length} 件\n`,
    );
  }
  if (urls.length === 0) {
    throw new Error('計測対象の URL がありません (include/exclude/limit を確認してください)');
  }
  await fs.writeFile(join(runDir, 'urls.txt'), urls.join('\n') + '\n', 'utf8');
  // 実行時の設定を (機密値を除いて) 書き戻す。resume と再実行に使う (F6 の再現性)
  await fs.writeFile(
    join(runDir, 'config.json'),
    JSON.stringify(toFileConfig(config), null, 2) + '\n',
    'utf8',
  );

  // ---- F2-8: resume ----
  const stateStore = new StateStore(join(runDir, 'state.jsonl'));
  const done = config.resumeFrom ? stateStore.load() : new Set<string>();

  // ---- 出力の準備 ----
  const resultsPath = config.output ?? join(runDir, 'results.csv');
  const csvWriter = new CsvWriter(resultsPath, { bom: config.bom });
  let columns: ColumnDefinition | null = null;
  const columnsPath = join(runDir, 'columns.json');
  if (config.resumeFrom && existsSync(columnsPath)) {
    columns = await loadColumnDefinition(columnsPath);
  }
  if (config.resumeFrom) {
    dedupeResultsCsv(resultsPath, done);
    // 既存の results.csv へ追記する (ヘッダーを書き直して既存行を消さない)
    if (existsSync(resultsPath)) csvWriter.continueExisting();
  }

  const rawStore = config.noRaw ? null : new RawStore(join(runDir, 'raw'));

  const tasks: { url: string; strategy: Strategy }[] = [];
  for (const url of urls) {
    for (const strategy of config.strategies) {
      tasks.push({ url, strategy });
    }
  }
  const pending = tasks.filter((t) => !done.has(stateKey(t.url, t.strategy)));
  const skipped = tasks.length - pending.length;
  if (skipped > 0) {
    process.stderr.write(`resume: ${skipped} 件の計測済み (URL, strategy) をスキップします\n`);
  }

  const progress = new ProgressReporter(pending.length);

  const limit = pLimit(config.concurrency);
  const tasksStarted = pending.map((task) =>
    limit(async () => {
      const { url, strategy } = task;
      const successful: { data: RunData; rawPath: string }[] = [];
      let lastError = '';

      for (let runNumber = 1; runNumber <= config.runs; runNumber++) {
        try {
          const { lhr } = await withRetry(
            async () => {
              const result = await runOnce(url, {
                strategy,
                extraHeaders: config.extraHeaders,
                userAgent: config.userAgent,
                timeoutMs: config.timeoutMs,
              });
              const runtimeError = runtimeErrorMessage(result.lhr);
              if (runtimeError) throw new Error(runtimeError);
              return result;
            },
            {
              retries: config.retries,
              onRetry: (attempt, error) =>
                logger.log(
                  `retry ${attempt}/${config.retries} ${strategy} ${url}: ${error.message}`,
                ),
            },
          );
          const rawPath = rawStore ? rawStore.save(url, strategy, runNumber, lhr) : '';
          successful.push({ data: extractRun(lhr), rawPath });
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          logger.log(`run 失敗 ${runNumber}/${config.runs} ${strategy} ${url}: ${lastError}`);
        }
      }

      let result: AggregatedResult;
      let rawPath = '';
      if (successful.length === 0) {
        result = aggregateError(config.runs, lastError);
      } else {
        result = aggregateRuns(
          successful.map((s) => s.data),
          config.runs,
        );
        // 代表 run の raw ファイルを辿れるようにする (F6-4)
        const rep = pickRepresentativeRun(successful.map((s) => s.data))!;
        const repIdx = successful.findIndex((s) => s.data === rep);
        rawPath = successful[repIdx]?.rawPath ?? '';
      }

      // ---- 列の確定 (5.1): 最初に成功した計測結果の audits から ----
      if (columns === null && successful.length > 0) {
        columns = buildColumnDefinition(result);
        await saveColumnDefinition(columnsPath, columns);
        csvWriter.writeHeader(columns.columns);
      }
      if (columns === null && successful.length === 0 && !existsSync(resultsPath)) {
        // 全 URL が失敗した場合でも固定列で出力する (5.1)
        columns = fixedOnlyColumnDefinition();
        await saveColumnDefinition(columnsPath, columns);
        csvWriter.writeHeader(columns.columns);
      }
      const columnDef = columns ?? fixedOnlyColumnDefinition();

      const unknownAuditIds: string[] = [];
      const row = buildRowValues(columnDef, url, strategy, result, rawPath, unknownAuditIds);
      for (const id of new Set(unknownAuditIds)) {
        logger.log(`警告: 未知の audit "${id}" を無視しました (columns.json にありません)`);
      }
      csvWriter.appendRow(columnDef.columns, row);
      // results.csv への追記が先、state.jsonl への追記が後 (5.4)
      stateStore.append(url, strategy);
      progress.report(url, strategy, result.status);

      // URL 間の待機 (5.6)
      if (config.delayMs > 0) await sleep(config.delayMs);
    }),
  );

  await Promise.all(tasksStarted);
  process.stderr.write('\n' + progress.summary() + '\n');
  return { urls: urls.length, tasks: tasks.length, skipped };
}
