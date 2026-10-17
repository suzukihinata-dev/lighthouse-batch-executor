/**
 * Lighthouse の結果 (LHR) のうち、このツールが使う部分の最小定義。
 * lighthouse パッケージにルートの型定義がないため、必要な形だけを定義する。
 */

export interface LhrAuditDetails {
  type?: string;
  items?: unknown[];
  overallSavingsMs?: number;
  overallSavingsBytes?: number;
}

export interface LhrAudit {
  id: string;
  title?: string;
  score: number | null;
  numericValue?: number;
  displayValue?: string;
  group?: string;
  details?: LhrAuditDetails;
}

export interface LhrCategory {
  id?: string;
  title?: string;
  score: number | null;
}

export interface LhrRuntimeError {
  code?: string;
  message?: string;
}

export interface Lhr {
  requestedUrl?: string;
  finalDisplayedUrl?: string;
  finalUrl?: string;
  fetchTime?: string;
  lighthouseVersion: string;
  runWarnings?: string[];
  runtimeError?: LhrRuntimeError;
  categories: Record<string, LhrCategory>;
  audits: Record<string, LhrAudit>;
  configSettings?: {
    extraHeaders?: Record<string, string>;
    emulatedUserAgent?: string;
    [key: string]: unknown;
  };
}
