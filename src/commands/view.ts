/**
 * `view` サブコマンド: 実行結果の CSV から診断結果 HTML を生成する。
 */
import { Command } from 'commander';
import { DEFAULTS } from '../config.js';
import { generateReport } from '../view/report.js';

export function buildViewCommand(): Command {
  const cmd = new Command('view')
    .description('実行結果 (results.csv) から診断結果 HTML を生成する')
    .argument('<runId>', '実行 ID (YYYYMMDD-HHmmss)')
    .option('--output-dir <dir>', '出力ディレクトリのルート', DEFAULTS.outputDir)
    .option('--out <path>', '生成する HTML のパス (既定: <output-dir>/<runId>/report.html)');

  cmd.action(async (runId: string) => {
    const outputDir = cmd.getOptionValue('outputDir') as string;
    const out = cmd.getOptionValue('out') as string | undefined;
    const dest = await generateReport(runId, outputDir, out);
    console.log(`診断結果 HTML を生成しました: ${dest}`);
  });
  return cmd;
}
