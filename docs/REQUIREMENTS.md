# Lighthouse Batch Executor 要件定義書

- 版: 0.2 (ドラフト)
- 作成日: 2026-10-17

## 1. 目的

指定したサイトの全URLに対して Lighthouse を一括実行し、結果を CSV にエクスポートする。
CSV には計測結果を可能な限り全て出力する。表示内容の絞り込みや制御は、別途開発するビューワーが担う。

## 2. スコープ

### 2.1 対象 (本書の範囲)

- sitemap.xml からの URL 収集
- 各 URL への Lighthouse 実行 (モバイル / デスクトップ、複数回測定)
- 複数回測定結果の中央値への集約
- 結果の CSV 出力

### 2.2 対象外

- ビューワー (別プロジェクトとして開発。本書では CSV を入力とする前提のインターフェースのみ定義する)
- sitemap.xml を持たないサイトのクロール
- 認証が必要なページの計測
- 定期実行・CI 連携・結果の時系列比較

## 3. 技術スタック

| 項目 | 内容 |
| --- | --- |
| 言語 | TypeScript (Node.js) |
| Lighthouse | `lighthouse` npm パッケージを API として利用 |
| ブラウザ | `chrome-launcher` 経由のヘッドレス Chrome |
| 実行形態 | CLI スクリプト |

Node.js のバージョンは Lighthouse の要求に合わせる (実装時に確定)。

## 4. 機能要件

### F1. URL 収集

- F1-1: 入力としてサイトのルート URL または sitemap.xml の URL を受け取る。
- F1-2: ルート URL のみ指定された場合は `/sitemap.xml` を取得する。`robots.txt` の `Sitemap:` 記述も探索する。
- F1-3: sitemap index (入れ子の sitemap) を再帰的に解決する。
- F1-4: 重複 URL を除去する。URL は正規化する (フラグメント除去、末尾スラッシュなどの扱いを統一)。
- F1-5: 次のオプションで対象を絞れる。
  - `--include` / `--exclude`: URL パターン (glob または正規表現)
  - `--limit`: 計測する最大 URL 数 (動作確認用)
- F1-6: 収集した URL 一覧は計測前にファイルへ保存し、件数を表示する。
- F1-7: sitemap が取得できない場合は、理由を表示して異常終了する。

### F2. Lighthouse 実行

- F2-1: 各 URL を、モバイルとデスクトップの両方で計測する。`--strategy mobile|desktop|both` で選択でき、既定は `both`。
  - モバイル: Lighthouse 既定設定 (モバイルエミュレーション + スロットリング)
  - デスクトップ: `desktop` プリセット
- F2-2: 1 URL × 1 strategy につき複数回計測する。既定は 3 回で、`--runs` で変更できる。
- F2-3: 計測するカテゴリは Performance / Accessibility / Best Practices / SEO の 4 つ。
- F2-4: 並列数を `--concurrency` で指定できる。既定は 1。計測値のぶれを抑えるため、既定は直列とする。
- F2-5: 計測に失敗した場合 (タイムアウト、ページエラーなど) はリトライする。既定は 2 回で、`--retries` で変更できる。
- F2-6: リトライしても失敗した計測はエラーとして記録し、処理は継続する (全体を止めない)。
- F2-7: 1 計測あたりのタイムアウトを設定できる。
- F2-8: 中断後に再開できる。計測済みの (URL, strategy) は再実行せずスキップする (`--resume`)。

### F3. 中央値への集約

- F3-1: 複数回の計測結果から、数値項目の中央値を算出する。
- F3-2: 代表 run として、Performance スコアが中央値に最も近い run を選ぶ。Lighthouse 公式の `getMedianRun` と同じ考え方を採る。
- F3-3: 成功した run が 1 回以上あれば集約する。成功 run が 0 回なら、その (URL, strategy) はエラー行とする。
- F3-4: 成功 run 数と全 run 数を結果に含める。

### F4. CSV 出力

- F4-1: 1 行は 1 つの (URL, strategy) の中央値結果とする。
- F4-2: ビューワーが表示内容を制御できるよう、取得可能な項目を全て列として出力する。詳細は 5 章を参照。
- F4-3: 文字コードは UTF-8 (BOM 付きのオプションを用意する。Excel 対策)。改行は LF。
- F4-4: RFC 4180 に従ってエスケープする。
- F4-5: 出力先は `--output` で指定する。既定は `./output/lighthouse-YYYYMMDD-HHmmss.csv`。
- F4-6: 計測の途中経過を逐次追記する。中断時にも、そこまでの結果が残るようにする。
- F4-7: 列の並びと列名は固定し、スキーマバージョンを管理する (ビューワーとの互換性のため)。

### F5. 進捗表示・ログ

- F5-1: 進捗 (完了数 / 総数、経過時間、残り時間の目安) をコンソールに表示する。
- F5-2: エラーの詳細をログファイルに保存する。
- F5-3: 終了時に、成功件数・失敗件数・所要時間のサマリを表示する。

### F6. 生データのバックアップ

- F6-1: 全 run (中央値に採用されなかったものを含む) の Lighthouse JSON レポートを保存する。保存先は `output/<実行ID>/raw/<strategy>/<URLのハッシュ>-run<N>.json`。
- F6-2: 容量削減のため、既定で gzip 圧縮して保存する (`.json.gz`)。`--no-raw` で保存を無効にできる。
- F6-3: URL とファイル名の対応を `output/<実行ID>/raw/index.csv` に記録する。
- F6-4: CSV の行から、代表 run の raw ファイルパスを辿れるよう、`raw_path` 列を持つ。
- F6-5: 用途は CSV の再生成と監査項目の再確認とする。ビューワーの入力ではない。

### F7. アクセス制御されたサイトへの対応

- F7-1: 計測はサイト所有者の依頼に基づく。利用者が許可を得たサイトにのみ実行する。
- F7-2: ベーシック認証に対応する。認証情報は環境変数 (`BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD`) から読み込み、CLI 引数には取らない (シェル履歴やプロセス一覧への露出を避ける)。
- F7-3: 任意の HTTP ヘッダー (`--header "Name: value"`) と User-Agent (`--user-agent`) を指定できる。Bot 対策側で許可リストに登録してもらう用途を想定する。
- F7-4: 認証情報とヘッダーの値は、ログ・CSV・raw レポートの設定情報に出力しない (マスクする)。
- F7-5: Bot 対策の突破 (CAPTCHA の回避など) は行わない。弾かれた URL は `status=error` として記録する。

## 5. CSV 仕様 (案)

`ビューワーが絞り込みに使う` 前提で、列を網羅的に出力する。

### 5.1 メタ情報

| 列名 | 内容 |
| --- | --- |
| `schema_version` | CSV スキーマのバージョン |
| `url` | 計測対象の URL |
| `strategy` | `mobile` / `desktop` |
| `fetched_at` | 計測日時 (ISO 8601) |
| `lighthouse_version` | 使用した Lighthouse のバージョン |
| `runs_total` | 実行した run 数 |
| `runs_succeeded` | 成功した run 数 |
| `status` | `ok` / `partial` / `error` |
| `error_message` | エラー内容 (失敗時) |
| `final_url` | リダイレクト後の最終 URL |
| `raw_path` | 代表 run の raw JSON のパス (`--no-raw` 時は空) |

### 5.2 カテゴリスコア (0〜100)

`score_performance`, `score_accessibility`, `score_best_practices`, `score_seo`

### 5.3 主要メトリクス (ミリ秒など、中央値)

`fcp_ms`, `lcp_ms`, `tbt_ms`, `cls`, `speed_index_ms`, `tti_ms`, `ttfb_ms` (`server-response-time`), `total_byte_weight`, `dom_size`

### 5.4 全監査項目

- Lighthouse の全 audit について、次の列を出力する。
  - `audit:<id>:score` (0〜1。該当なしや情報のみは空)
  - `audit:<id>:value` (`numericValue`。ある場合のみ)
- audit 数が多いため列数は多くなる。これは許容する (ビューワーで制御する前提)。
- 列の集合は Lighthouse バージョンによって変わる。全 URL で列を揃えるため、出力開始時に列を確定させる。

### 5.5 改善項目の詳細

- 失敗した監査 (score < 1) の ID 一覧を `failed_audits` に格納する (区切り文字は `;`)。
- Opportunities / Diagnostics の詳細 (対象リソースなど) も CSV に含める。列数の爆発を避けるため、次の JSON 文字列列にまとめる。
  - `opportunities_json`: 改善提案の audit の配列。各要素は `id`, `score`, `numericValue`, `displayValue`, `overallSavingsMs`, `overallSavingsBytes`, `items` (対象リソースの一覧)
  - `diagnostics_json`: Diagnostics 系 audit の配列。要素の形は上と同じ
- JSON 文字列は RFC 4180 に従ってエスケープする。ビューワーは JSON としてパースして使う。

## 6. 非機能要件

| 区分 | 要件 |
| --- | --- |
| 信頼性 | 一部の URL の失敗で全体を止めない。中断後に再開できる |
| 再現性 | 実行時の設定 (strategy、runs、Lighthouse バージョンなど) を出力に残す |
| 負荷配慮 | 対象サイトへの負荷を考慮し、既定は直列実行。URL 間の待機時間を設定できる (`--delay`) |
| 性能 | 目安: 100 URL × 2 strategy × 3 回 = 600 計測。1 計測を約 30 秒とすると約 5 時間 (直列時)。並列化で短縮できる |
| 保守性 | URL 収集、計測、集約、CSV 出力をモジュールに分離する |
| 安全性 | 計測対象は利用者が指定したサイトのみ。許可のないサイトへの大量アクセスは行わない旨を README に記す |

## 7. CLI インターフェース (案)

```text
lighthouse-batch --site https://example.com \
  [--sitemap <url>] [--strategy both] [--runs 3] \
  [--concurrency 1] [--retries 2] [--delay 0] [--timeout 120000] \
  [--include <pattern>] [--exclude <pattern>] [--limit <n>] \
  [--header "Name: value"] [--user-agent <ua>] [--no-raw] \
  [--output <path>] [--bom] [--resume]
```

ベーシック認証の情報は環境変数 `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` で渡す。

## 8. 未確定事項

1. 並列実行時の計測精度への影響を、どこまで許容するか (既定は直列)。
2. 同一サイトの実行結果の履歴管理 (実行IDごとにディレクトリを分ける案を F6 で採用済み。追記運用が必要か)。
3. Node.js の最低バージョンと、Chrome の取得方法 (システムの Chrome を使うか、同梱するか)。

### 解決済み (v0.2)

- Opportunities / Diagnostics の詳細は CSV に含める (JSON 文字列列。5.5 章)。
- 生の Lighthouse JSON はバックアップ用に保存する (F6)。
- Bot 対策・ベーシック認証は、所有者の許可を前提に F7 の範囲で対応する。

## 9. 受け入れ基準

- AC1: sitemap.xml を持つ実在サイトを指定すると、全 URL が収集される (sitemap index を含む)。
- AC2: 各 URL がモバイル / デスクトップで計測され、CSV に (URL, strategy) ごとに 1 行ずつ出力される。
- AC3: 値は複数回の中央値であり、`runs_succeeded` が記録されている。
- AC4: 一部の URL が失敗しても処理が完了し、その行が `status=error` で記録される。
- AC5: 中断後に `--resume` を付けて再実行すると、計測済みの組み合わせがスキップされる。
- AC6: 出力 CSV が RFC 4180 に従い、Excel と一般的な CSV パーサで読み込める。
- AC7: 全カテゴリスコア、主要メトリクス、全 audit が列として出力される。
- AC8: `opportunities_json` と `diagnostics_json` が有効な JSON としてパースできる。
- AC9: 全 run の raw JSON が `.json.gz` で保存され、`raw_path` から代表 run を辿れる。
- AC10: ベーシック認証付きのサイトを計測でき、認証情報がログ・CSV・raw に残らない。
