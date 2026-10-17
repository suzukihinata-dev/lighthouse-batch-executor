import { describe, expect, it } from 'vitest';
import { parseFileConfig, buildRunConfig, toFileConfig } from '../../src/config-file.js';
import { ConfigError, formatRunId, type RunConfig } from '../../src/config.js';

describe('parseFileConfig', () => {
  it('設定ファイルの各キーを解析する', () => {
    const config = parseFileConfig(`{
      "site": "https://example.com",
      "runs": 5,
      "strategy": "mobile",
      "include": ["/products/*"],
      "delay": 1000,
      "bom": true,
      "noRaw": true
    }`);
    expect(config).toEqual({
      site: 'https://example.com',
      runs: 5,
      strategy: 'mobile',
      include: ['/products/*'],
      delay: 1000,
      bom: true,
      noRaw: true,
    });
  });

  it('未知のキーはエラー', () => {
    expect(() => parseFileConfig('{"site": "x", "run": 3}')).toThrow(/未知のキー "run"/);
  });

  it('型が不正ならエラー', () => {
    expect(() => parseFileConfig('{"runs": "three"}')).toThrow(/"runs".*型が不正/);
    expect(() => parseFileConfig('{"include": "/products/*"}')).toThrow(/"include".*型が不正/);
    expect(() => parseFileConfig('{"strategy": "tablet"}')).toThrow(/"strategy".*型が不正/);
  });

  it('JSON でなければエラー', () => {
    expect(() => parseFileConfig('not json')).toThrow(ConfigError);
  });

  it('null 値は無視する', () => {
    expect(parseFileConfig('{"site": null}')).toEqual({});
  });
});

describe('buildRunConfig (優先順位: CLI > 設定ファイル > 既定値)', () => {
  const base = { now: new Date('2026-10-17T10:00:00+09:00') };

  it('設定ファイルだけのときはファイル値を使う', () => {
    const config = buildRunConfig({
      ...base,
      file: { site: 'https://example.com', runs: 5, delay: 500 },
    });
    expect(config.site).toBe('https://example.com');
    expect(config.runs).toBe(5);
    expect(config.delayMs).toBe(500);
    expect(config.concurrency).toBe(1); // 既定値
    expect(config.runId).toBe(formatRunId(base.now));
  });

  it('CLI の明示指定が設定ファイルより優先される', () => {
    const config = buildRunConfig({
      ...base,
      file: { site: 'https://example.com', runs: 5, delay: 500 },
      cli: { runs: 2 },
    });
    expect(config.runs).toBe(2);
    expect(config.delayMs).toBe(500); // CLI で指定していないのでファイル値
  });

  it('strategy を展開する', () => {
    expect(
      buildRunConfig({ ...base, file: { site: 'x' }, cli: { strategy: 'mobile' } }).strategies,
    ).toEqual(['mobile']);
    expect(buildRunConfig({ ...base, file: { site: 'x' } }).strategies).toEqual([
      'mobile',
      'desktop',
    ]);
  });

  it('urls 指定時は site が無くてもよい', () => {
    const config = buildRunConfig({ ...base, urls: ['https://example.com/a'] });
    expect(config.urls).toEqual(['https://example.com/a']);
  });

  it('site も urls も無ければエラー', () => {
    expect(() => buildRunConfig({ ...base })).toThrow(/--site/);
  });

  it('ベーシック認証を extraHeaders へ (環境変数から)', () => {
    const config = buildRunConfig({
      ...base,
      file: { site: 'x' },
      env: { BASIC_AUTH_USER: 'user', BASIC_AUTH_PASSWORD: 'pass' },
    });
    expect(config.extraHeaders['Authorization']).toBe(
      `Basic ${Buffer.from('user:pass').toString('base64')}`,
    );
  });

  it('resumeFrom が runId になる', () => {
    const config = buildRunConfig({ ...base, urls: ['x'], resumeFrom: '20261017-100000' });
    expect(config.runId).toBe('20261017-100000');
    expect(config.resumeFrom).toBe('20261017-100000');
  });
});

describe('toFileConfig (実行時の設定の書き戻し)', () => {
  it('機密情報 (extraHeaders / auth) を含まない', () => {
    const config: RunConfig = {
      site: 'https://example.com',
      strategies: ['mobile', 'desktop'],
      runs: 3,
      concurrency: 1,
      retries: 2,
      delayMs: 0,
      timeoutMs: 120_000,
      extraHeaders: { Authorization: 'Basic secret', 'X-Token': 'tok' },
      auth: { user: 'u', password: 'p' },
      noRaw: false,
      bom: true,
      allowExternalHosts: false,
      outputDir: 'output',
      runId: '20261017-100000',
    };
    const file = toFileConfig(config);
    const text = JSON.stringify(file);
    expect(text).not.toContain('secret');
    expect(text).not.toContain('tok');
    expect(file).toEqual({
      site: 'https://example.com',
      strategy: 'both',
      runs: 3,
      concurrency: 1,
      retries: 2,
      delay: 0,
      timeout: 120_000,
      noRaw: false,
      bom: true,
      allowExternalHosts: false,
      outputDir: 'output',
    });
    // 書き戻した形式は設定ファイルとして再利用できる
    expect(() => parseFileConfig(text)).not.toThrow();
  });
});
