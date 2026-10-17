/**
 * `resume` サブコマンド: 中断した実行を再開する。
 * 実行ディレクトリの config.json と urls.txt を再利用するため、--site は不要。
 */
import { Command } from 'commander';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildRunConfig, loadFileConfig, type FileConfig } from '../config-file.js';
import { runPipeline } from '../pipeline.js';
import { latestRunId } from '../output/state.js';
import { addMeasureOptions, explicitOptions } from './options.js';

function resolveRunId(specified: string | undefined, outputDir: string): string {
  if (specified) return specified;
  const latest = latestRunId(readdirSync, outputDir);
  return latest ?? '';
}

export function buildResumeCommand(): Command {
  const cmd = new Command('resume')
    .description('中断した実行を再開する (実行 ID 省略時は最新)')
    .argument('[runId]', '再開する実行 ID (YYYYMMDD-HHmmss)')
    .option('--config <path>', 'JSON 設定ファイル (CLI 指定の方が優先)');

  addMeasureOptions(cmd);

  cmd.action(async (runIdArg: string | undefined) => {
    const cli = explicitOptions(cmd);
    const outputDir = (cli['outputDir'] as string | undefined) ?? 'output';

    let runId = runIdArg ?? '';
    if (runId === '') {
      runId = resolveRunId(undefined, outputDir);
    }
    if (runId === '' || !/^\d{8}-\d{6}$/.test(runId)) {
      throw new Error('resume 先の実行が見つかりません (resume <実行ID> を指定してください)');
    }

    const runDir = join(outputDir, runId);
    if (!existsSync(runDir)) {
      throw new Error(`実行ディレクトリがありません: ${runDir}`);
    }

    // 実行時の設定を再利用する (機密情報は実行時に環境変数・CLI から渡す)
    let file: FileConfig | undefined;
    const configJsonPath = join(runDir, 'config.json');
    if (existsSync(configJsonPath)) file = await loadFileConfig(configJsonPath);
    const configPath = cli['config'] as string | undefined;
    if (configPath) file = { ...file, ...(await loadFileConfig(configPath)) };

    const urlsTxtPath = join(runDir, 'urls.txt');
    if (!existsSync(urlsTxtPath)) {
      throw new Error(`urls.txt がありません: ${urlsTxtPath} (--site を指定して run してください)`);
    }
    const urls = readFileSync(urlsTxtPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '');

    const config = buildRunConfig({ file, cli, urls, resumeFrom: runId });
    await runPipeline(config);
  });
  return cmd;
}
