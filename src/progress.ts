/**
 * 進捗表示とサマリ (F5)。
 */

export interface ProgressStats {
  ok: number;
  partial: number;
  error: number;
}

export class ProgressReporter {
  private readonly startedAt = Date.now();
  private completed = 0;
  private readonly stats: ProgressStats = { ok: 0, partial: 0, error: 0 };

  constructor(
    readonly total: number,
    private readonly write: (line: string) => void = (line) => process.stderr.write(line),
  ) {}

  report(url: string, strategy: string, status: 'ok' | 'partial' | 'error'): void {
    this.completed += 1;
    this.stats[status] += 1;
    const elapsedSec = (Date.now() - this.startedAt) / 1000;
    const avgSec = elapsedSec / this.completed;
    const remainingSec = Math.max(0, avgSec * (this.total - this.completed));
    const line =
      `[${this.completed}/${this.total}] ${strategy} ${url} → ${status} ` +
      `(経過 ${formatDuration(elapsedSec)}, 残り目安 ${formatDuration(remainingSec)})\n`;
    this.write(line);
  }

  /** 終了時のサマリ (F5-3)。 */
  summary(): string {
    const elapsedSec = (Date.now() - this.startedAt) / 1000;
    return [
      `完了: ${this.completed}/${this.total}`,
      `  ok: ${this.stats.ok}`,
      `  partial: ${this.stats.partial}`,
      `  error: ${this.stats.error}`,
      `所要時間: ${formatDuration(elapsedSec)}`,
    ].join('\n');
  }
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec)) return '-';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  if (h > 0) return `${h}時間${m}分${rest}秒`;
  if (m > 0) return `${m}分${rest}秒`;
  return `${rest}秒`;
}
