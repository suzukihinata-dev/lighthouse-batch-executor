/**
 * ログファイルへの出力と機密値のマスク (F5-2、F7-4、設計判断 5.5)。
 */
import { appendFileSync } from 'node:fs';

/** 機密値 (認証情報、ヘッダーの値) を *** へ置換する。 */
export function maskSecrets(text: string, secrets: (string | undefined)[]): string {
  let masked = text;
  for (const secret of secrets) {
    if (secret && secret.length > 0) {
      masked = masked.split(secret).join('***');
    }
  }
  return masked;
}

export class Logger {
  readonly secrets: string[];

  constructor(
    readonly logPath: string,
    secrets: (string | undefined)[],
  ) {
    this.secrets = secrets.filter((s): s is string => typeof s === 'string' && s.length > 0);
  }

  /** 1 行をログに追記する。機密値は出力前にマスクする。 */
  log(message: string): void {
    const line = `${new Date().toISOString()}\t${maskSecrets(message, this.secrets)}\n`;
    appendFileSync(this.logPath, line, 'utf8');
  }

  /** マスク付きで整形する (コンソール出力にも使う)。 */
  mask(message: string): string {
    return maskSecrets(message, this.secrets);
  }
}
