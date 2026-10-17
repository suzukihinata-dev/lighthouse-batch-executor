import { describe, expect, it, afterAll } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  existsSync,
  readdirSync,
  appendFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { StateStore, stateKey, latestRunId } from '../../src/output/state.js';
import { RawStore, urlHash } from '../../src/output/raw.js';
import { withRetry, isRetryable } from '../../src/lighthouse/retry.js';
import { MeasurementTimeoutError } from '../../src/lighthouse/runner.js';

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lhe-test-'));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('StateStore (resume)', () => {
  it('追記した (url, strategy) を読み込める', () => {
    const dir = tempDir();
    const store = new StateStore(join(dir, 'state.jsonl'));
    store.append('https://example.com/a', 'mobile');
    store.append('https://example.com/a', 'desktop');
    store.append('https://example.com/b', 'mobile');
    const done = store.load();
    expect(done.has(stateKey('https://example.com/a', 'mobile'))).toBe(true);
    expect(done.has(stateKey('https://example.com/a', 'desktop'))).toBe(true);
    expect(done.has(stateKey('https://example.com/b', 'desktop'))).toBe(false);
    expect(done.size).toBe(3);
  });

  it('壊れた最終行は無視する', () => {
    const dir = tempDir();
    const path = join(dir, 'state.jsonl');
    const store = new StateStore(path);
    store.append('https://example.com/a', 'mobile');
    // 書き込み途中を想定した壊れた行を追記
    appendFileSync(path, '{"url":"https://example.com/b","strat', 'utf8');
    const done = store.load();
    expect(done.has(stateKey('https://example.com/a', 'mobile'))).toBe(true);
    expect(done.size).toBe(1);
  });

  it('ファイルが無ければ空集合', () => {
    const store = new StateStore(join(tempDir(), 'none.jsonl'));
    expect(store.load().size).toBe(0);
  });
});

describe('latestRunId', () => {
  it('最新の実行 ID を返す', () => {
    const dir = tempDir();
    for (const id of ['20260101-000000', '20260102-120000', 'not-a-run']) {
      mkdirSync(join(dir, id));
    }
    expect(latestRunId(() => readdirSync(dir), dir)).toBe('20260102-120000');
  });
});

describe('RawStore (AC9)', () => {
  it('LHR を gzip で保存し、index.csv に記録する', () => {
    const dir = tempDir();
    const store = new RawStore(join(dir, 'raw'));
    const lhr = {
      lighthouseVersion: '12.8.2',
      categories: {},
      audits: {},
      configSettings: { extraHeaders: { Authorization: 'Basic secret' } },
    };
    const path = store.save('https://example.com/a', 'mobile', 1, lhr);
    expect(path.endsWith('.json.gz')).toBe(true);
    expect(path).toContain(join('mobile', `${urlHash('https://example.com/a')}-run1.json.gz`));
    const restored = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8'));
    expect(restored.configSettings.extraHeaders).toEqual({});
    const index = readFileSync(join(dir, 'raw', 'index.csv'), 'utf8');
    expect(index).toContain('mobile,1,mobile/');
    expect(index).not.toContain('secret');
  });

  it('desktop は desktop/ ディレクトリへ', () => {
    const dir = tempDir();
    const store = new RawStore(join(dir, 'raw'));
    const path = store.save('https://example.com/a', 'desktop', 2, {
      lighthouseVersion: '12.8.2',
      categories: {},
      audits: {},
    });
    expect(path).toContain(join('desktop', `${urlHash('https://example.com/a')}-run2.json.gz`));
    expect(existsSync(join(dir, 'raw', 'desktop'))).toBe(true);
  });
});

describe('withRetry', () => {
  it('リトライ可能なエラーは指定回数リトライする', async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new MeasurementTimeoutError('https://example.com/', 1000);
        return 'ok';
      },
      { retries: 2, baseDelayMs: 1 },
    );
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('リトライ不可能なエラーは即座に諦める', async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw new Error('PAGE_LOAD_ERROR: 404');
        },
        { retries: 3, baseDelayMs: 1 },
      ),
    ).rejects.toThrow('PAGE_LOAD_ERROR');
    expect(attempts).toBe(1);
  });

  it('リトライ回数を使い切ると最後のエラーを投げる', async () => {
    await expect(
      withRetry(
        async () => {
          throw new MeasurementTimeoutError('https://example.com/', 1000);
        },
        { retries: 2, baseDelayMs: 1 },
      ),
    ).rejects.toThrow(MeasurementTimeoutError);
  });

  it('isRetryable の判定', () => {
    expect(isRetryable(new MeasurementTimeoutError('u', 1))).toBe(true);
    expect(isRetryable(new Error('fetch failed: ECONNRESET'))).toBe(true);
    expect(isRetryable(new Error('PROTOCOL_TIMEOUT: timed out'))).toBe(true);
    expect(isRetryable(new Error('PAGE_LOAD_ERROR: 404'))).toBe(false);
    expect(isRetryable(new Error('NO_FCP: page did not paint'))).toBe(false);
  });
});
