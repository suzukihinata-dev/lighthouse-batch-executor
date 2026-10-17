import { describe, expect, it } from 'vitest';
import { squarify, scoreColor, textOn, overallScore } from '../../src/view/treemap.js';

describe('squarify', () => {
  it('矩形の面積が value に比例する', () => {
    const rects = squarify([1, 2, 1], 200, 100);
    const total = rects.reduce((a, r) => a + r.w * r.h, 0);
    expect(total).toBeCloseTo(200 * 100, -6);
    const areas = rects.map((r) => r.w * r.h);
    expect(areas[1]! / areas[0]!).toBeCloseTo(2, 5);
    expect(areas[2]! / areas[0]!).toBeCloseTo(1, 5);
  });

  it('矩形が領域を覆い、重ならない', () => {
    const rects = squarify([3, 1, 4, 1, 5, 9, 2, 6], 300, 200);
    // 重なりなし (軸に沿った矩形同士の交差チェック)
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!;
        const b = rects[j]!;
        const overlap =
          Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.01 &&
          Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.01;
        expect(overlap).toBe(false);
      }
    }
    // 領域内に収まる
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(-0.01);
      expect(r.y).toBeGreaterThanOrEqual(-0.01);
      expect(r.x + r.w).toBeLessThanOrEqual(300.01);
      expect(r.y + r.h).toBeLessThanOrEqual(200.01);
    }
  });

  it('要素 1 個は領域全体を使う', () => {
    expect(squarify([5], 100, 50)).toEqual([{ x: 0, y: 0, w: 100, h: 50 }]);
  });

  it('合計 0 や不正なサイズではゼロ矩形を返す', () => {
    expect(squarify([0, 0], 100, 100).every((r) => r.w === 0 && r.h === 0)).toBe(true);
    expect(squarify([1, 2], 0, 100).every((r) => r.w === 0 && r.h === 0)).toBe(true);
  });
});

describe('scoreColor (標準 90 = イエロー、±7 点 = 3σ で赤↔緑)', () => {
  it('83 点 (−3σ) は赤、90 点 (基準) はイエロー、97 点 (+3σ) は緑', () => {
    expect(scoreColor(83)).toBe('#c0392b');
    expect(scoreColor(90)).toBe('#e6be20');
    expect(scoreColor(97)).toBe('#1e8449');
  });

  it('基準以下は赤側にクランプされる', () => {
    expect(scoreColor(0)).toBe(scoreColor(83));
    expect(scoreColor(-20)).toBe(scoreColor(83));
  });

  it('+3σ 以上は緑にクランプされる', () => {
    expect(scoreColor(150)).toBe(scoreColor(97));
    expect(scoreColor(100)).toBe('#1e8449');
  });

  it('null (エラー・採点なし) はグレー', () => {
    expect(scoreColor(null)).toBe('#8e8e93');
    expect(scoreColor(Number.NaN)).toBe('#8e8e93');
  });

  it('基準を挟んで補間される (基準未満は赤寄り、超えは緑寄り)', () => {
    const below = scoreColor(86);
    const above = scoreColor(94);
    // 赤成分は基準未満の方が多い
    expect(parseInt(below.slice(1, 3), 16)).toBeGreaterThan(parseInt(above.slice(1, 3), 16));
    // 緑成分は基準超の方が多い
    expect(parseInt(above.slice(3, 5), 16)).toBeGreaterThan(parseInt(below.slice(3, 5), 16));
  });
});

describe('textOn', () => {
  it('明るい背景には黒、暗い背景には白', () => {
    expect(textOn('#ffffff')).toBe('#1c1c1e');
    expect(textOn('#000000')).toBe('#ffffff');
    expect(textOn('#c0392b')).toBe('#ffffff');
    expect(textOn('#d9a11d')).toBe('#1c1c1e'); // 琥珀は明るいので黒文字
  });
});

describe('overallScore', () => {
  it('4 カテゴリの平均', () => {
    expect(overallScore({ performance: 80, accessibility: 90, best_practices: 100, seo: 70 })).toBe(
      85,
    );
  });

  it('null のカテゴリは除外して平均', () => {
    expect(
      overallScore({ performance: 80, accessibility: null, best_practices: null, seo: null }),
    ).toBe(80);
  });

  it('全て null なら null', () => {
    expect(overallScore({ performance: null, accessibility: null })).toBeNull();
  });
});
