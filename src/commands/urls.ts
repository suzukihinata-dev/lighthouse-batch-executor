/**
 * `urls` サブコマンド: URL 収集のみを実行して表示する (計測しない)。
 */
import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import { buildRunConfig, loadFileConfig } from '../config-file.js';
import { collectUrls } from '../sitemap/collect.js';
import { filterUrls } from '../url/filter.js';
import { defaultFetchText } from '../pipeline.js';
import { addFilterOptions, explicitOptions } from './options.js';

export function buildUrlsCommand(): Command {
  const cmd = new Command('urls')
    .description('sitemap から URL を収集して表示する (計測はしない)')
    .requiredOption('--site <url>', 'サイトのルート URL または sitemap.xml の URL')
    .option('--sitemap <url>', 'sitemap.xml の URL を明示指定')
    .option('--allow-external-hosts', 'sitemap 内の外部ホスト URL を含める', false)
    .option('--output <path>', 'URL 一覧の保存先ファイル')
    .option('--config <path>', 'JSON 設定ファイル (CLI 指定の方が優先)');

  addFilterOptions(cmd);

  cmd.action(async () => {
    const cli: Record<string, unknown> = {
      ...explicitOptions(cmd),
      site: cmd.getOptionValue('site'),
    };
    const configPath = cli['config'] as string | undefined;
    const file = configPath ? await loadFileConfig(configPath) : undefined;
    const config = buildRunConfig({ file, cli });

    const collected = await collectUrls(config.sitemap ?? config.site!, defaultFetchText, {
      allowExternalHosts: config.allowExternalHosts,
    });
    if (collected.externalSkipped.length > 0) {
      process.stderr.write(
        `警告: 外部ホストのため除外: ${collected.externalSkipped.length} 件 (--allow-external-hosts で含められます)\n`,
      );
    }
    const urls = filterUrls(collected.urls, {
      include: config.include,
      exclude: config.exclude,
      limit: config.limit,
    });
    for (const url of urls) console.log(url);
    process.stderr.write(`\n収集: ${collected.urls.length} 件、絞り込み後: ${urls.length} 件\n`);
    if (typeof cli['output'] === 'string') {
      await fs.writeFile(cli['output'], urls.join('\n') + '\n', 'utf8');
      process.stderr.write(`保存しました: ${cli['output']}\n`);
    }
  });
  return cmd;
}
