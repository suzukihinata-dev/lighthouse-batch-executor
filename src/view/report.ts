/**
 * 診断結果 HTML (ビューアー) の生成。
 *
 * results.csv の内容を単一の HTML ファイルに埋め込む。外部リソースに依存しない
 * ため、生成されたファイルをそのまま配布・閲覧できる。
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { readCsv, type CsvTable } from '../output/csv.js';
import { overallScore, scoreColor, squarify, textOn } from './treemap.js';

export interface ViewDetailItem {
  id: string;
  score: number | null;
  displayValue?: string;
  overallSavingsMs?: number;
  overallSavingsBytes?: number;
  items: unknown[];
  truncated?: boolean;
}

export interface ViewRow {
  url: string;
  strategy: string;
  status: string;
  error: string;
  finalUrl: string;
  rawPath: string;
  fetchedAt: string;
  runsTotal: string;
  runsSucceeded: string;
  lighthouseVersion: string;
  scores: Record<string, number | null>;
  metrics: Record<string, number | null>;
  failedAudits: string[];
  opportunities: ViewDetailItem[];
  diagnostics: ViewDetailItem[];
}

function num(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function details(value: string | undefined): ViewDetailItem[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as ViewDetailItem[]) : [];
  } catch {
    return [];
  }
}

/** results.csv の 1 行を ViewRow へ変換する。 */
export function toViewRow(table: CsvTable, row: string[]): ViewRow {
  const col = (name: string): string => {
    const idx = table.header.indexOf(name);
    return idx >= 0 ? (row[idx] ?? '') : '';
  };
  return {
    url: col('url'),
    strategy: col('strategy'),
    status: col('status'),
    error: col('error_message'),
    finalUrl: col('final_url'),
    rawPath: col('raw_path'),
    fetchedAt: col('fetched_at'),
    runsTotal: col('runs_total'),
    runsSucceeded: col('runs_succeeded'),
    lighthouseVersion: col('lighthouse_version'),
    scores: {
      performance: num(col('score_performance')),
      accessibility: num(col('score_accessibility')),
      best_practices: num(col('score_best_practices')),
      seo: num(col('score_seo')),
    },
    metrics: {
      fcp_ms: num(col('fcp_ms')),
      lcp_ms: num(col('lcp_ms')),
      tbt_ms: num(col('tbt_ms')),
      cls: num(col('cls')),
      speed_index_ms: num(col('speed_index_ms')),
      tti_ms: num(col('tti_ms')),
      ttfb_ms: num(col('ttfb_ms')),
      total_byte_weight: num(col('total_byte_weight')),
      dom_size: num(col('dom_size')),
    },
    failedAudits: col('failed_audits') === '' ? [] : col('failed_audits').split(';'),
    opportunities: details(col('opportunities_json')),
    diagnostics: details(col('diagnostics_json')),
  };
}

export function toViewRows(table: CsvTable): ViewRow[] {
  return table.rows.map((row) => toViewRow(table, row));
}

/** script タグの早期終了や XSS を防ぐため、埋め込み JSON をエスケープする。 */
export function embedJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export interface ReportMeta {
  runId: string;
  generatedAt: string;
}

/** 診断結果 HTML を組み立てる (純粋関数)。 */
export function buildReportHtml(rows: ViewRow[], meta: ReportMeta): string {
  const counts = { ok: 0, partial: 0, error: 0 };
  for (const row of rows) {
    if (row.status === 'ok' || row.status === 'partial' || row.status === 'error') {
      counts[row.status] += 1;
    }
  }
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lighthouse 診断結果 — ${escapeHtml(meta.runId)}</title>
<style>
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 14px; }
header { padding: 16px 20px 8px; }
h1 { font-size: 18px; margin: 0 0 4px; }
.meta { color: gray; font-size: 12px; }
.chip { display: inline-block; margin: 8px 8px 0 0; padding: 2px 10px; border-radius: 10px; font-size: 12px; }
.chip.ok { background: #d9f2dd; color: #1c5c2c; }
.chip.partial { background: #fdeecb; color: #7a5a10; }
.chip.error { background: #f8d7da; color: #842029; }
.controls { display: flex; gap: 8px; padding: 8px 20px; flex-wrap: wrap; align-items: center; }
.controls input, .controls select { padding: 4px 8px; font-size: 13px; }
#count { color: gray; font-size: 12px; }
main { padding: 0 20px 40px; overflow-x: auto; }
table { border-collapse: collapse; width: 100%; }
th, td { padding: 5px 8px; border-bottom: 1px solid #8884; text-align: right; white-space: nowrap; }
th { position: sticky; top: 0; background: canvas; cursor: pointer; user-select: none; }
th:first-child, td:first-child { text-align: left; max-width: 420px; overflow: hidden; text-overflow: ellipsis; }
td.url a { color: inherit; }
.status { font-size: 12px; }
.status.ok { color: #1c7c33; }
.status.partial { color: #9a7212; }
.status.error { color: #c5303a; }
.score { font-variant-numeric: tabular-nums; }
.score.s90 { color: #147d3a; font-weight: 600; }
.score.s50 { color: #9a7212; font-weight: 600; }
.score.s0 { color: #c5303a; font-weight: 600; }
tr.detail-row > td { background: #8881; white-space: normal; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 8px 0; }
dt { color: gray; } dt::after { content: ":"; }
dd { margin: 0; overflow-wrap: anywhere; }
.badges span { display: inline-block; margin: 0 4px 4px 0; padding: 1px 8px; border-radius: 8px; background: #8883; font-size: 12px; }
table.inner { width: auto; }
table.inner th, table.inner td { text-align: left; }
footer { padding: 12px 20px; color: gray; font-size: 12px; }
section.map { padding: 4px 20px 0; }
.map-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.map-head h2 { font-size: 14px; margin: 8px 0; }
.map-head select { padding: 4px 8px; font-size: 13px; }
.legend { display: flex; align-items: center; gap: 6px; font-size: 12px; margin-left: auto; }
.legend .bar { width: 140px; height: 10px; border-radius: 5px; background: linear-gradient(90deg, #c0392b, #d9a11d 50%, #1e8449); }
.legend .none { display: inline-block; width: 12px; height: 12px; border-radius: 3px; background: #8e8e93; vertical-align: -2px; }
#map { position: relative; height: 420px; margin-top: 6px; }
#map .tile { position: absolute; border-radius: 4px; overflow: hidden; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; cursor: pointer; box-shadow: inset 0 0 0 1px rgba(127,127,127,.25); }
#map .tile .sc { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.1; }
#map .tile .u { font-size: 11px; opacity: .85; max-width: 94%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#map .tile:hover { outline: 2px solid #888; z-index: 2; }
#tip { position: fixed; display: none; pointer-events: none; background: canvas; color: canvastext; border: 1px solid #8886; border-radius: 6px; padding: 6px 10px; font-size: 12px; z-index: 10; max-width: 360px; box-shadow: 0 2px 8px #0003; }
#tip .u { max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
#map-detail { margin: 8px 0 0; padding: 10px 14px; border: 1px solid #8884; border-radius: 8px; }
#map-detail:empty { display: none; }
</style>
</head>
<body>
<header>
  <h1>Lighthouse 診断結果</h1>
  <div class="meta">実行 ${escapeHtml(meta.runId)} ・ 生成 ${escapeHtml(meta.generatedAt)} ・ Lighthouse ${escapeHtml(rows[0]?.lighthouseVersion ?? '')}</div>
  <div class="chip ok">ok: ${counts.ok}</div>
  <div class="chip partial">partial: ${counts.partial}</div>
  <div class="chip error">error: ${counts.error}</div>
</header>
<div class="controls">
  <input id="q" type="search" placeholder="URL で絞り込み">
  <select id="f-strategy"><option value="">全 strategy</option><option>mobile</option><option>desktop</option></select>
  <select id="f-status"><option value="">全 status</option><option>ok</option><option>partial</option><option>error</option></select>
  <span id="count"></span>
</div>
<section class="map" aria-label="総合得点マップ">
  <div class="map-head">
    <h2>総合得点マップ (4 カテゴリ スコアの平均)</h2>
    <label>サイズ:
      <select id="map-size">
        <option value="equal">均等</option>
        <option value="bytes">ページ容量</option>
        <option value="savings">改善の余地 (合計節約 ms)</option>
      </select>
    </label>
    <div class="legend">
      <span>0</span><span class="bar"></span><span>100</span>
      <span class="none" title="エラー / 採点なし"></span><span>エラー</span>
    </div>
  </div>
  <div id="map"></div>
  <div id="map-detail"></div>
</section>
<main>
<table id="tbl">
<thead><tr>
  <th data-sort="url">URL</th><th>strategy</th><th>status</th>
  <th data-sort="scores.performance">Perf</th><th data-sort="scores.accessibility">A11y</th>
  <th data-sort="scores.best_practices">BP</th><th data-sort="scores.seo">SEO</th>
  <th data-sort="metrics.fcp_ms">FCP</th><th data-sort="metrics.lcp_ms">LCP</th>
  <th data-sort="metrics.tbt_ms">TBT</th><th data-sort="metrics.cls">CLS</th>
  <th data-sort="failed">failed</th>
</tr></thead>
<tbody></tbody>
</table>
</main>
<footer>このファイルは単体で動作します (外部リソースなし)。元データ: results.csv / raw/</footer>
<div id="tip"></div>
<script>
const DATA = ${embedJson(rows)};
// 純粋関数は src/view/treemap.ts から .toString() で埋め込む (単体テスト対象)
${squarify.toString()}
${scoreColor.toString()}
${textOn.toString()}
${overallScore.toString()}
const METRICS = [
  ['fcp_ms', 'FCP'], ['lcp_ms', 'LCP'], ['tbt_ms', 'TBT'], ['cls', 'CLS'],
  ['speed_index_ms', 'Speed Index'], ['tti_ms', 'TTI'], ['ttfb_ms', 'TTFB'],
  ['total_byte_weight', 'Total Byte Weight'], ['dom_size', 'DOM Size'],
];
function get(row, key) {
  return key.split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, row);
}
function fmtMs(v) { return v == null ? '' : v >= 1000 ? (v / 1000).toFixed(2) + ' s' : Math.round(v) + ' ms'; }
function fmtBytes(v) {
  if (v == null) return '';
  if (v >= 1024 * 1024) return (v / 1024 / 1024).toFixed(1) + ' MiB';
  if (v >= 1024) return Math.round(v / 1024) + ' KiB';
  return v + ' B';
}
function fmtNum(v) { return v == null ? '' : String(Math.round(v * 100) / 100); }
function scoreClass(v) { return v == null ? '' : v >= 90 ? 's90' : v >= 50 ? 's50' : 's0'; }
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
var sortKey = null, sortDesc = false;
function cmp(a, b) {
  var av = get(a, sortKey), bv = get(b, sortKey);
  var an = av == null || av === '', bn = bv == null || bv === '';
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  if (typeof av === 'number' && typeof bv === 'number') return av - bv;
  return String(av).localeCompare(String(bv));
}
function detailInner(row) {
  var m = METRICS.map(function (pair) {
    var k = pair[0], label = pair[1];
    var text = k === 'total_byte_weight' ? fmtBytes(row.metrics[k]) : k === 'cls' ? fmtNum(row.metrics[k]) : fmtMs(row.metrics[k]);
    return '<dt>' + label + '</dt><dd>' + text + '</dd>';
  }).join('');
  var html = '<dl>' +
    '<dt>status</dt><dd class="status ' + row.status + '">' + row.status + '</dd>' +
    '<dt>総合得点</dt><dd>' + (overallScore(row.scores) == null ? '—' : overallScore(row.scores)) + ' / 100</dd>' +
    '<dt>runs</dt><dd>' + row.runsSucceeded + ' / ' + row.runsTotal + '</dd>' +
    '<dt>final_url</dt><dd>' + esc(row.finalUrl) + '</dd>' +
    '<dt>fetched_at</dt><dd>' + esc(row.fetchedAt) + '</dd>' +
    '<dt>raw</dt><dd>' + esc(row.rawPath || '(なし)') + '</dd>' +
    (row.error ? '<dt>error</dt><dd>' + esc(row.error) + '</dd>' : '') +
    m + '</dl>';
  html += '<div class="badges">' + row.failedAudits.map(function (a) { return '<span>' + esc(a) + '</span>'; }).join('') + '</div>';
  if (row.opportunities.length > 0) {
    html += '<h4>Opportunities</h4><table class="inner"><thead><tr><th>audit</th><th>表示値</th><th>節約 (時間)</th><th>節約 (容量)</th><th>対象</th></tr></thead><tbody>';
    row.opportunities.forEach(function (o) {
      html += '<tr><td>' + esc(o.id) + '</td><td>' + esc(o.displayValue || '') + '</td><td>' +
        (o.overallSavingsMs ? fmtMs(o.overallSavingsMs) : '') + '</td><td>' +
        (o.overallSavingsBytes ? fmtBytes(o.overallSavingsBytes) : '') + '</td><td>' +
        (o.items ? o.items.length : 0) + ' 件' + (o.truncated ? ' (打ち切り)' : '') + '</td></tr>';
    });
    html += '</tbody></table>';
  }
  if (row.diagnostics.length > 0) {
    html += '<h4>Diagnostics</h4><ul>' +
      row.diagnostics.map(function (d) { return '<li>' + esc(d.id) + (d.displayValue ? ' — ' + esc(d.displayValue) : '') + '</li>'; }).join('') +
      '</ul>';
  }
  return html;
}
function detailHtml(row) {
  return '<tr class="detail-row"><td colspan="12">' + detailInner(row) + '</td></tr>';
}
function currentRows() {
  var q = document.getElementById('q').value.trim().toLowerCase();
  var fs = document.getElementById('f-strategy').value;
  var fst = document.getElementById('f-status').value;
  return DATA.filter(function (r) {
    return (!q || r.url.toLowerCase().indexOf(q) >= 0) && (!fs || r.strategy === fs) && (!fst || r.status === fst);
  });
}
function tileValue(row) {
  var mode = document.getElementById('map-size').value;
  if (mode === 'bytes') return Math.max(row.metrics.total_byte_weight || 0, 1);
  if (mode === 'savings') {
    var sum = 0;
    row.opportunities.forEach(function (o) { sum += o.overallSavingsMs || 0; });
    return Math.max(sum, 1);
  }
  return 1;
}
function shortUrl(url) {
  try {
    var u = new URL(url);
    return (u.pathname === '/' ? '/' : u.pathname) + u.search;
  } catch (e) { return url; }
}
function tipHtml(row) {
  var s = row.scores;
  function cell(v) { return v == null ? '—' : v; }
  return '<div class="u">' + esc(row.url) + '</div>' +
    '<div>' + esc(row.strategy) + ' ・ ' + row.status + ' ・ 総合 ' + (overallScore(s) == null ? '—' : overallScore(s)) + '</div>' +
    '<div>Perf ' + cell(s.performance) + ' / A11y ' + cell(s.accessibility) + ' / BP ' + cell(s.best_practices) + ' / SEO ' + cell(s.seo) + '</div>' +
    (row.error ? '<div>' + esc(row.error.slice(0, 80)) + '</div>' : '');
}
function renderMap() {
  var map = document.getElementById('map');
  var rows = currentRows();
  map.innerHTML = '';
  if (rows.length === 0) { map.textContent = '該当する行がありません'; return; }
  var W = map.clientWidth || 800;
  var H = map.clientHeight || 420;
  var rects = squarify(rows.map(tileValue), W, H);
  var tip = document.getElementById('tip');
  rects.forEach(function (rect, i) {
    var row = rows[i];
    var score = overallScore(row.scores);
    var bg = scoreColor(score);
    var fg = textOn(bg);
    var tile = document.createElement('div');
    tile.className = 'tile';
    tile.style.cssText =
      'left:' + rect.x + 'px;top:' + rect.y + 'px;width:' + rect.w + 'px;height:' + rect.h + 'px;' +
      'background:' + bg + ';color:' + fg + ';';
    var area = rect.w * rect.h;
    var label = '';
    if (area >= 2200) {
      label = '<div class="sc">' + (score == null ? '—' : score) + '</div>';
      if (area >= 5200) label += '<div class="u">' + esc(shortUrl(row.url)) + '</div>';
      if (area >= 9000 && row.strategy) label += '<div class="u">' + esc(row.strategy) + '</div>';
    }
    tile.innerHTML = label;
    tile.addEventListener('mousemove', function (ev) {
      tip.style.display = 'block';
      tip.innerHTML = tipHtml(row);
      var x = Math.min(ev.clientX + 14, window.innerWidth - 380);
      tip.style.left = x + 'px';
      tip.style.top = (ev.clientY + 16) + 'px';
    });
    tile.addEventListener('mouseleave', function () { tip.style.display = 'none'; });
    tile.addEventListener('click', function () {
      document.getElementById('map-detail').innerHTML = detailInner(row);
    });
    map.appendChild(tile);
  });
}
function render() {
  var rows = currentRows();
  if (sortKey) rows = rows.slice().sort(function (a, b) { return sortDesc ? -cmp(a, b) : cmp(a, b); });
  var tbody = document.querySelector('#tbl tbody');
  tbody.innerHTML = rows.map(function (row) {
    var s = row.scores;
    return '<tr data-i="' + DATA.indexOf(row) + '">' +
      '<td class="url"><a href="' + esc(row.url) + '" target="_blank" rel="noreferrer">' + esc(row.url) + '</a></td>' +
      '<td>' + esc(row.strategy) + '</td>' +
      '<td class="status ' + row.status + '">' + row.status + '</td>' +
      ['performance', 'accessibility', 'best_practices', 'seo'].map(function (k) {
        return '<td class="score ' + scoreClass(s[k]) + '">' + (s[k] == null ? '' : s[k]) + '</td>';
      }).join('') +
      '<td>' + fmtMs(row.metrics.fcp_ms) + '</td>' +
      '<td>' + fmtMs(row.metrics.lcp_ms) + '</td>' +
      '<td>' + fmtMs(row.metrics.tbt_ms) + '</td>' +
      '<td>' + fmtNum(row.metrics.cls) + '</td>' +
      '<td>' + row.failedAudits.length + '</td></tr>';
  }).join('');
  document.getElementById('count').textContent = rows.length + ' / ' + DATA.length + ' 行';
  document.querySelectorAll('#tbl tbody tr[data-i]').forEach(function (tr) {
    tr.addEventListener('click', function () {
      var next = tr.nextElementSibling;
      if (next && next.classList.contains('detail-row')) { next.remove(); return; }
      document.querySelectorAll('.detail-row').forEach(function (d) { d.remove(); });
      tr.insertAdjacentHTML('afterend', detailHtml(DATA[Number(tr.dataset.i)]));
    });
  });
}
document.querySelectorAll('th[data-sort]').forEach(function (th) {
  th.addEventListener('click', function () {
    var key = th.dataset.sort;
    if (sortKey === key) { sortDesc = !sortDesc; } else { sortKey = key; sortDesc = false; }
    render();
  });
});
function renderAll() {
  render();
  renderMap();
}
['q', 'f-strategy', 'f-status'].forEach(function (id) {
  document.getElementById(id).addEventListener('input', renderAll);
});
document.getElementById('map-size').addEventListener('change', renderMap);
window.addEventListener('resize', function () {
  clearTimeout(window.__mapTimer);
  window.__mapTimer = setTimeout(renderMap, 150);
});
renderAll();
</script>
</body>
</html>
`;
}

/** 実行ディレクトリの results.csv から診断結果 HTML を生成する。戻り値は生成先パス。 */
export async function generateReport(
  runId: string,
  outputDir: string,
  outPath?: string,
): Promise<string> {
  const runDir = join(outputDir, runId);
  const table = readCsv(join(runDir, 'results.csv'));
  if (table === null) {
    throw new Error(
      `results.csv がありません: ${join(runDir, 'results.csv')} (先に run を実行してください)`,
    );
  }
  const dest = outPath ?? join(runDir, 'report.html');
  const html = buildReportHtml(toViewRows(table), {
    runId,
    generatedAt: new Date().toISOString(),
  });
  await fs.writeFile(dest, html, 'utf8');
  return dest;
}
