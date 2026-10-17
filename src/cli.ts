#!/usr/bin/env node
/**
 * CLI エントリポイント。サブコマンド (run / urls / resume / list / show) の組み立て。
 *
 *   lighthouse-batch run --site https://example.com --limit 5
 *   lighthouse-batch run --config batch.json
 *   lighthouse-batch urls --site https://example.com
 *   lighthouse-batch resume [runId]
 *   lighthouse-batch list
 *   lighthouse-batch show <runId>
 */
import { Command } from 'commander';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildRunCommand } from './commands/run.js';
import { buildUrlsCommand } from './commands/urls.js';
import { buildResumeCommand } from './commands/resume.js';
import { buildListCommand, buildShowCommand } from './commands/inspect.js';

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('lighthouse-batch')
    .description(
      '指定サイトの sitemap 内の全 URL に Lighthouse を実行し、CSV へ出力する\n' +
        '  計測はサイト所有者の依頼・許可に基づき、許可を得たサイトにのみ実行してください',
    )
    .version('0.1.0');
  program.addCommand(buildRunCommand());
  program.addCommand(buildUrlsCommand());
  program.addCommand(buildResumeCommand());
  program.addCommand(buildListCommand());
  program.addCommand(buildShowCommand());
  return program;
}

export async function main(argv: string[]): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
  } catch (error) {
    process.stderr.write(`エラー: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

// グローバルインストールでは bin がシンボリックリンク経由で起動されるため、
// 実パスを解決してから自分自身の起動かを判定する
function isDirectRun(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  void main(process.argv);
}
