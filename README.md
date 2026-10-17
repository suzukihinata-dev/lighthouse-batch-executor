# Lighthouse Batch Executor

指定したサイトの sitemap.xml に含まれる全 URL に対して Lighthouse を一括実行し、結果を CSV にエクスポートする CLI ツールです。

> **重要**: このツールはサイト所有者の依頼・許可に基づき、**許可を得たサイトにのみ**実行してください。許可のないサイトへの大量アクセスは行わないでください。

## 必要環境

- Node.js 20 以上 (Lighthouse 12 は Node >=18.16 を要求)
- Google Chrome (システムにインストールされたものを使用。`CHROME_PATH` 環境変数で上書き可能)

## インストール

インストールすると `lighthouse-batch` コマンドが使えるようになります (ビルドは `prepare` スクリプトが自動で実行します)。

### リポジトリからグローバルインストール

```sh
git clone <このリポジトリ>
cd lighthouse-batch-executor
npm install -g .
lighthouse-batch --help
```

更新するときは `git pull` 後に `npm install -g .` を再実行してください。

### 開発中に使う (リンク)

```sh
cd lighthouse-batch-executor
npm link
```

グローバルからリポジトリへシンボリックリンクが張られ、`npm run build` の成果物がそのまま使えます。修正後は `npm run build` だけで反映されます。外すときは `npm unlink -g lighthouse-batch` です。

### tarball で配布する

```sh
npm pack                                   # lighthouse-batch-executor-0.1.0.tgz ができる
npm install -g lighthouse-batch-executor-0.1.0.tgz   # 他のマシンで
```

### アンインストール

```sh
npm uninstall -g lighthouse-batch-executor
```

## クイックスタート

```sh
# 1. URL 収集だけ試す (計測しない)
lighthouse-batch urls --site https://example.com --limit 5

# 2. 小規模に計測する
lighthouse-batch run --site https://example.com --limit 5 --runs 1 --strategy mobile

# 3. 本番実行 (全 URL、モバイル・デスクトップ両方、3 回ずつ)
lighthouse-batch run --site https://example.com
```

`run` は指定サイトの `/sitemap.xml` (または robots.txt の `Sitemap:` 記述) から URL を収集し、各 URL をモバイル・デスクトップの両方で 3 回ずつ計測して、中央値を集約した `output/<実行ID>/results.csv` に出力します。

## サブコマンド一覧

| コマンド         | 説明                                                       |
| ---------------- | ---------------------------------------------------------- |
| `run`            | URL 収集から計測・CSV 出力までの全体実行                   |
| `urls`           | URL 収集のみ (計測しない)。動作確認に使う                  |
| `resume [runId]` | 中断した実行を再開 (実行 ID 省略時は最新)。`--site` は不要 |
| `list`           | 出力ディレクトリ内の実行一覧と進捗を表示                   |
| `show <runId>`   | 指定した実行の設定・結果サマリ・エラー一覧を表示           |
| `view <runId>`   | 実行結果 (results.csv) から診断結果 HTML を生成する        |

```sh
# 設定ファイルで実行
lighthouse-batch run --config batch.json

# 計測と同時に診断結果 HTML まで生成
lighthouse-batch run --site https://example.com --view

# 中断からの再開 (Ctrl+C した後など)
lighthouse-batch resume                  # 最新の実行
lighthouse-batch resume 20261017-183000

# 実行の一覧と結果の確認
lighthouse-batch list
lighthouse-batch show 20261017-183000

# 診断結果 HTML の生成
lighthouse-batch view 20261017-183000                    # output/<runId>/report.html へ
lighthouse-batch view 20261017-183000 --out report.html  # パス指定
```

## 診断結果 HTML (`view` / `--view`)

`results.csv` の全行を単一の HTML ファイルに埋め込んだビューアーです。外部リソースを一切読み込まないため、生成された `report.html` はそのままブラウザで開け、チームへの配布もできます。

- **サマリ**: ok / partial / error の件数
- **総合得点マップ (トレリーマップ)**: 1 タイル = 1 URL。**モバイル / デスクトップの切替ボタンで選んだ一方だけ表示**します (両方が並ぶことはありません)。色は総合得点 (4 カテゴリスコアの平均) を**標準スコア 90 を基準 (イエロー) に ±7 点 (3σ) の範囲 (83〜97) で赤 ↔ 緑へ補間** (83 点以下 = レッド、97 点以上 = グリーン、エラー行はグレー)。タイルの大きさは「均等 / ページ容量 / 改善の余地 (合計節約 ms)」から選択可能。ホバーで詳細ツールチップ、クリックで行の詳細を展開
- **一覧表**: URL、strategy、status、4 カテゴリスコア (色分け)、FCP / LCP / TBT / CLS、失敗 audit 数
- **操作**: URL 検索、strategy / status での絞り込み (マップと表に同時反映)、列クリックでソート
- **行の詳細** (行をクリック): 全メトリクス、総合得点、final_url、`raw_path`、エラー内容、失敗 audit 一覧、Opportunities (節約時間・容量・対象件数)、Diagnostics

CSV の再生成や監査の再確認には `raw/` の生 JSON (F6) を使ってください。

`--help` を付けると各コマンドのオプション一覧が表示されます。

## 設定ファイル (`--config`)

JSON 形式で繰り返し使う設定を切り出せます。優先順位は「CLI の明示指定 > 設定ファイル > 既定値」です。機密情報 (ヘッダー値・認証) は設定ファイルに書かず、CLI と環境変数で渡してください。

```json
{
  "site": "https://example.com",
  "runs": 3,
  "strategy": "both",
  "include": ["/products/*"],
  "exclude": ["/private/*"],
  "delay": 1000
}
```

| キー                 | 型       | 既定                          | 説明                                                      |
| -------------------- | -------- | ----------------------------- | --------------------------------------------------------- |
| `site`               | string   | -                             | サイトのルート URL または sitemap.xml の URL              |
| `sitemap`            | string   | -                             | sitemap.xml の URL を明示指定                             |
| `strategy`           | string   | `both`                        | `mobile` / `desktop` / `both`                             |
| `runs`               | number   | `3`                           | 1 (URL, strategy) あたりの計測回数                        |
| `concurrency`        | number   | `1`                           | 並列数 (既定は直列。並列化すると計測値がぶれる可能性あり) |
| `retries`            | number   | `2`                           | リトライ回数                                              |
| `delay`              | number   | `0`                           | URL 間の待機ミリ秒                                        |
| `timeout`            | number   | `120000`                      | 1 計測のタイムアウト (ミリ秒)                             |
| `include`            | string[] | -                             | 対象に含める URL の glob パターン                         |
| `exclude`            | string[] | -                             | 対象から除外する URL の glob パターン                     |
| `limit`              | number   | -                             | 計測する最大 URL 数                                       |
| `userAgent`          | string   | -                             | User-Agent の上書き                                       |
| `noRaw`              | boolean  | `false`                       | 生 JSON の保存を行わない                                  |
| `output`             | string   | `output/<実行ID>/results.csv` | 出力 CSV のパス                                           |
| `bom`                | boolean  | `false`                       | CSV に BOM を付ける (Excel 対策)                          |
| `allowExternalHosts` | boolean  | `false`                       | sitemap 内の外部ホスト URL も計測する                     |
| `outputDir`          | string   | `output`                      | 出力ディレクトリのルート                                  |

CLI オプションは設定ファイルのキーに対応します (`delay` → `--delay`、`userAgent` → `--user-agent`)。計測系 (`run` / `resume`) では `--header "Name: value"` も使えます。

実行時の設定は (機密情報を除いて) 各実行ディレクトリに `config.json` として保存され、`resume` はこれを再利用します。

## ベーシック認証

認証情報は CLI 引数ではなく環境変数で渡します (シェル履歴・プロセス一覧への露出を避けるため)。

```sh
BASIC_AUTH_USER=user BASIC_AUTH_PASSWORD=pass lighthouse-batch run --site https://staging.example.com
```

認証情報・ヘッダーの値はログ・CSV・生 JSON に出力されません (`***` へマスク / 保存前に除去)。

Bot 対策の突破 (CAPTCHA の回避など) は行いません。弾かれた URL は `status=error` として記録されます。

## 出力

```text
output/<実行ID>/            # 実行 ID は YYYYMMDD-HHmmss
├─ results.csv              # 最終成果物 (1 行 = 1 (URL, strategy) の中央値結果)
├─ report.html              # 診断結果 HTML (view / --view で生成)
├─ columns.json             # 確定した列定義 (resume 時に再利用)
├─ config.json              # 実行時の設定 (機密値を除く。resume が再利用)
├─ state.jsonl              # 完了した (URL, strategy) の記録 (resume 用)
├─ urls.txt                 # 収集した URL 一覧
├─ run.log                  # 詳細ログ (機密値はマスク済み)
└─ raw/
   ├─ index.csv             # URL と raw ファイルの対応
   ├─ mobile/<hash>-run<N>.json.gz   # 全 run の Lighthouse JSON (gzip)
   └─ desktop/...
```

### CSV の列

- **メタ情報**: `schema_version`, `url`, `strategy`, `fetched_at`, `lighthouse_version`, `runs_total`, `runs_succeeded`, `status` (`ok` / `partial` / `error`), `error_message`, `final_url`, `raw_path`
- **カテゴリスコア** (0〜100): `score_performance`, `score_accessibility`, `score_best_practices`, `score_seo`
- **主要メトリクス** (中央値): `fcp_ms`, `lcp_ms`, `tbt_ms`, `cls`, `speed_index_ms`, `tti_ms`, `ttfb_ms`, `total_byte_weight`, `dom_size`
- **全監査項目**: `audit:<id>:score` (0〜1)、`audit:<id>:value` (`numericValue`)
- **改善項目の詳細**: `failed_audits` (`;` 区切りの audit ID)、`opportunities_json`、`diagnostics_json` (JSON 文字列。`items` は 1 audit あたり 50 件で打ち切り、`truncated: true` を付ける)

数値項目は複数回計測の**中央値** (偶数回は中央 2 件の平均) です。`failed_audits`・JSON 列・`final_url`・`raw_path` は Performance スコアが中央値に最も近い**代表 run** の値です。

#### `columns.json` と列の固定

audit の列は Lighthouse バージョンによって変わるため、最初に成功した計測結果から列を確定し `columns.json` に保存します。以降の行 (resume 再開時を含む) はこの列だけを出力し、未知の audit は警告ログの上、無視されます。全 URL が失敗した場合は固定列のみで出力します。

#### ビューアーとの契約

- 文字コードは UTF-8、改行は LF、エスケープは RFC 4180 準拠 (`--bom` で BOM 付き)
- `schema_version` が同じなら列の並び・列名は固定
- `opportunities_json` / `diagnostics_json` は JSON としてパースして利用する

## 負荷への配慮

既定は直列実行 (concurrency 1) です。並列化 (`--concurrency`) は計測値のぶれを招く可能性があるため利用者の判断で行ってください。対象サイトへの負荷を抑えるには `--delay` で URL 間の待機を設定できます。

目安: 100 URL × 2 strategy × 3 回 = 600 計測。1 計測を約 30 秒とすると約 5 時間 (直列時) です。

## 開発

リポジトリをチェックアウトして開発する場合:

```sh
npm install           # prepare で自動ビルドされる
npm test              # 単体テスト (Lighthouse を起動しない)
npm run test:integration  # 結合テスト (ローカルサーバー + 実 Lighthouse。遅い)
npm run lint          # eslint + prettier
npm run build         # tsc によるビルド
npm run dev -- run --site https://example.com --limit 2   # ビルドなしで実行
```

- ドキュメント: [要件定義書](docs/REQUIREMENTS.md) / [実装計画書](docs/PLAN.md)
