/**
 * トレリーマップのレイアウトと、総合得点の色計算。
 *
 * ここは純粋関数のみとし、単体テストもここで行う。
 * ブラウザー側には .toString() でソースを埋め込むため、各 exported 関数は
 * モジュールスコープのヘルパーを参照しない自己完結形にすること。
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * squarified treemap。values の各要素に対応する矩形を (x, y, w, h) で返す。
 * 矩形の面積は value に比例し、順序は values と同じ。
 */
export function squarify(values: number[], width: number, height: number): Rect[] {
  // 行 (同じ帯に並べる要素群) の最悪アスペクト比。t は帯の厚み。
  function worstRatio(areas: number[], t: number): number {
    let worst = 0;
    for (const area of areas) {
      const l = area / t;
      const r = l >= t ? l / t : t / l;
      if (r > worst) worst = r;
    }
    return worst;
  }

  const rects: Rect[] = values.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0 || width <= 0 || height <= 0) return rects;

  const scale = (width * height) / total;
  const items = values.map((v, i) => ({ area: Math.max(v, 0) * scale, i }));

  let x = 0;
  let y = 0;
  let w = width;
  let h = height;
  let idx = 0;

  while (idx < items.length) {
    if (w <= 0 || h <= 0) break;
    // 幅 < 高さ なら縦の帯 (幅 t)、そうでなければ横の帯 (高さ t) を詰める
    const vertical = w < h;
    const stripLen = vertical ? h : w;

    const row = [items[idx]!];
    idx += 1;
    let rowAreas = [row[0]!.area];
    let best = worstRatio(rowAreas, rowAreas.reduce((a, b) => a + b, 0) / stripLen);
    while (idx < items.length) {
      const next = items[idx]!;
      const areas = [...rowAreas, next.area];
      const t = areas.reduce((a, b) => a + b, 0) / stripLen;
      const ratio = worstRatio(areas, t);
      if (ratio > best) break;
      best = ratio;
      row.push(next);
      rowAreas = areas;
      idx += 1;
    }

    const area = rowAreas.reduce((a, b) => a + b, 0);
    const t = area / stripLen;
    let off = 0;
    for (const item of row) {
      const l = item.area / t;
      rects[item.i] = vertical ? { x, y: y + off, w: t, h: l } : { x: x + off, y, w: l, h: t };
      off += l;
    }
    if (vertical) {
      x += t;
      w -= t;
    } else {
      y += t;
      h -= t;
    }
  }
  return rects;
}

/**
 * 色軸のパラメータ: 標準スコア 90 を基準 (イエロー) とし、
 * 3シグマ = ±7 点の範囲 (83〜97) で赤 ↔ 緑に遷移する。
 * (ブラウザー埋め込みのため scoreColor 内にも同じ値を literal で持つ)
 */
export const SCORE_BASELINE = 90;
export const SCORE_SIGMA_RANGE = 7;

/** 総合得点を色に変換する。null (エラー・採点なし) はグレー。自己完結形。 */
export function scoreColor(score: number | null): string {
  // 色軸のアンカー: -3σ (83 点以下) = 赤、基準 (90 点) = イエロー、+3σ (97 点以上) = 緑
  const BASELINE = 90;
  const SIGMA = 7;
  const RED = [192, 57, 43];
  const AMBER = [230, 190, 32];
  const GREEN = [30, 132, 73];

  function mix(a: number[], b: number[], t: number): string {
    const r = Math.round(a[0]! + (b[0]! - a[0]!) * t);
    const g = Math.round(a[1]! + (b[1]! - a[1]!) * t);
    const bl = Math.round(a[2]! + (b[2]! - a[2]!) * t);
    return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`;
  }

  if (score === null || !Number.isFinite(score)) return '#8e8e93';
  // 基準からの偏差を -1〜+1 に正規化する
  const t = Math.max(-1, Math.min(1, (score - BASELINE) / SIGMA));
  return t < 0 ? mix(RED, AMBER, t + 1) : mix(AMBER, GREEN, t);
}

/** 背景色に対して読める文字色 (黒 / 白) を返す。 */
export function textOn(bg: string): string {
  const v = bg.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? '#1c1c1e' : '#ffffff';
}

/** 4 カテゴリのスコアから総合得点 (平均) を出す。全て null なら null。 */
export function overallScore(scores: {
  performance?: number | null;
  accessibility?: number | null;
  best_practices?: number | null;
  seo?: number | null;
}): number | null {
  const values = [
    scores.performance,
    scores.accessibility,
    scores.best_practices,
    scores.seo,
  ].filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}
