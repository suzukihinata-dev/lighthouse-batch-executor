/**
 * `run` サブコマンド: URL 収集から計測・CSV 出力までの全体実行。
 */
import { Command } from 'commander';
import { buildRunConfig, loadFileConfig } from '../config-file.js';
import { runPipeline } from '../pipeline.js';
import { generateReport } from '../view/report.js';
import { addFilterOptions, addMeasureOptions, explicitOptions } from './options.js';

export function buildRunCommand(): Command {
  const cmd = new Command('run')
    .description('sitemap から URL を収集し、Lighthouse を実行して CSV へ出力する')
    .requiredOption('--site <url>', 'サイトのルート URL または sitemap.xml の URL')
    .option('--config <path>', 'JSON 設定ファイル (CLI 指定の方が優先)');

  addMeasureOptions(cmd);
  addFilterOptions(cmd);

  cmd.action(async () => {
    const cli: Record<string, unknown> = {
      ...explicitOptions(cmd),
      site: cmd.getOptionValue('site'),
    };
    const configPath = cli['config'] as string | undefined;
    const file = configPath ? await loadFileConfig(configPath) : undefined;
    const config = buildRunConfig({ file, cli });
    await runPipeline(config);
    if (cli['view']) {
      const dest = await generateReport(config.runId, config.outputDir, config.output);
      console.log(`診断結果 HTML を生成しました: ${dest}`);
    }
  });
  return cmd;
}
