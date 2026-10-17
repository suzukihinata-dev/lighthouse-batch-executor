# Lighthouse Batch Executor

指定したサイトの sitemap.xml に含まれる全 URL に対して Lighthouse を一括実行し、結果を CSV にエクスポートする CLI ツールです。

> **重要**: このツールはサイト所有者の依頼・許可に基づき、**許可を得たサイトにのみ**実行してください。許可のないサイトへの大量アクセスは行わないでください。

## 必要環境

- Node.js 20 以上 (Lighthouse 12 は Node >=18.16 を要求)
- Google Chrome (システムにインストールされたものを使用。`CHROME_PATH` 環境変数で上書き可能)

## セットアップ

```sh
npm install
npm run build
```

開発中はビルドなしで `npm run dev -- --site ...` でも実行できます。

## 使い方

```sh
node dist/cli.js --site https://example.com
```

指定サイトの `/sitemap.xml` (または robots.txt の `Sitemap:` 記述) から URL を収集し、各 URL をモバイル・デスクトップの両方で 3 回ずつ計測して、中央値を集約した `output/<実行ID>/results.csv` に出力します。

### オプション一覧

| オプション | 既定 | 説明 |
| --- | --- | --- |
| `--site <url>` | (必須) | サイトのルート URL または sitemap.xml の URL |
| `--sitemap <url>` | - | sitemap.xml の URL を明示指定 |
| `--strategy <type>` | `both` | `mobile` / `desktop` / `both` |
| `--runs <n>` | `3` | 1 (URL, strategy) あたりの計測回数 |
| `--concurrency <n>` | `1` | 並列数 (既定は直列。並列化すると計測値がぶれる可能性あり) |
| `--retries <n>` | `2` | リトライ回数 |
| `--delay <ms>` | `0` | URL 間の待機ミリ秒 |
| `--timeout <ms>` | `120000` | 1 計測のタイムアウト |
| `--include <pattern...>` | - | 対象に含める URL の glob パターン (パスまたは URL 全体に一致) |
| `--exclude <pattern...>` | - | 対象から除外する URL の glob パターン |
| `--limit <n>` | - | 計測する最大 URL 数 (動作確認用) |
| `--header <header...>` | - | 追加 HTTP ヘッダー (`"Name: value"`) |
| `--user-agent <ua>` | - | User-Agent の上書き |
| `--no-raw` | - | 生 JSON の保存を行わない |
| `--output <path>` | `output/<実行ID>/results.csv` | 出力 CSV のパス |
| `--bom` | - | CSV に BOM を付ける (Excel 対策) |
| `--resume [runId]` | - | 中断した実行を再開 (実行 ID 省略時は最新) |
| `--allow-external-hosts` | - | sitemap 内の外部ホスト URL も計測する (既定は警告の上、除外) |
| `--output-dir <dir>` | `output` | 出力ディレクトリのルート |

### ベーシック認証

認証情報は CLI 引数ではなく環境変数で渡します (シェル履歴・プロセス一覧への露出を避けるため)。

```sh
BASIC_AUTH_USER=user BASIC_AUTH_PASSWORD=pass node dist/cli.js --site https://staging.example.com
```

認証情報・ヘッダーの値はログ・CSV・生 JSON に出力されません (`***` へマスク / 保存前に除去)。

### 中断からの再開

```sh
# Ctrl+C などで中断した後:
node dist/cli.js --site https://example.com --resume           # 最新の実行を再開
node dist/cli.js --site https://example.com --resume 20261017-183000
```

計測済みの (URL, strategy) はスキップされ、残りだけが実行されます。

## 出力

```text
output/<実行ID>/            # 実行 ID は YYYYMMDD-HHmmss
├─ results.csv              # 最終成果物 (1 行 = 1 (URL, strategy) の中央値結果)
├─ columns.json             # 確定した列定義 (resume 時に再利用)
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

## 開発

```sh
npm test              # 単体テスト (Lighthouse を起動しない)
npm run test:integration  # 結合テスト (ローカルサーバー + 実 Lighthouse。遅い)
npm run lint          # eslint + prettier
npm run build         # tsc によるビルド
```

- ドキュメント: [要件定義書](docs/REQUIREMENTS.md) / [実装計画書](docs/PLAN.md)
