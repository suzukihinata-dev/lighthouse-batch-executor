# Lighthouse Batch Executor 実装計画

- 版: 0.1 (ドラフト)
- 作成日: 2026-10-17
- 参照: [REQUIREMENTS.md](./REQUIREMENTS.md) v0.2

## 1. 方針

- 要件の F1〜F7 を、依存の少ない順に 6 フェーズで実装する。
- 各フェーズの終わりに動作確認できる状態にする。
- 純粋関数(URL 収集の解析、中央値、CSV 組み立て)と I/O(HTTP、Chrome、ファイル)を分離する。純粋関数は Lighthouse を起動せずにテストする。
- Lighthouse を実際に起動するテストは遅いため、通常のテストとは別に実行する。

## 2. 技術選定

| 用途 | 採用 | 理由 |
| --- | --- | --- |
| 実行基盤 | Node.js 22 LTS (暫定) | Lighthouse の `engines` に合わせる。着手時に最新版の要求を確認して確定する |
| 言語 | TypeScript (ESM) | Lighthouse は ESM 専用のため、プロジェクトも ESM にする |
| 計測 | `lighthouse`, `chrome-launcher` | 公式 API。CLI の子プロセス起動より、設定・結果の取り回しが容易 |
| CLI 引数 | `commander` | 標準的で依存が軽い |
| sitemap 解析 | `fast-xml-parser` | sitemap と sitemap index の双方を扱える |
| URL パターン | `picomatch` | glob 指定の `--include` / `--exclude` 用 |
| 並列制御 | `p-limit` | `--concurrency` の実装 |
| gzip | Node 標準 `zlib` | 追加依存なし |
| CSV 書き出し | 自前の小さな writer | 列を固定して逐次追記するため。ライブラリの恩恵が小さい |
| テスト | `vitest` | TypeScript と ESM をそのまま扱える |
| 開発時実行 | `tsx` | ビルド不要で実行 |
| 整形・検査 | `eslint`, `prettier` | 既存の `.gitignore` 以外は未整備のため新規導入 |

HTTP 取得は Node 標準の `fetch` を使う。

## 3. ディレクトリ構成

```text
lighthouse-batch-executor/
├─ docs/
│  ├─ REQUIREMENTS.md
│  └─ PLAN.md
├─ src/
│  ├─ cli.ts                 # 引数解析、全体の組み立て
│  ├─ config.ts              # 設定の型、既定値、検証
│  ├─ sitemap/
│  │  ├─ discover.ts         # sitemap の場所を決める(robots.txt を含む)
│  │  ├─ parse.ts            # XML の解析(純粋関数)
│  │  └─ collect.ts          # index の再帰解決、重複除去
│  ├─ url/
│  │  ├─ normalize.ts        # URL の正規化
│  │  └─ filter.ts           # include / exclude / limit
│  ├─ lighthouse/
│  │  ├─ runner.ts           # Chrome 起動、1 回の計測
│  │  ├─ options.ts          # mobile / desktop の設定、ヘッダー、認証
│  │  └─ retry.ts            # リトライ、タイムアウト
│  ├─ aggregate/
│  │  ├─ extract.ts          # LHR から 1 run 分の行を作る(純粋関数)
│  │  └─ median.ts           # 中央値、代表 run の選択(純粋関数)
│  ├─ output/
│  │  ├─ columns.ts          # 列定義、スキーマバージョン
│  │  ├─ csv.ts              # RFC 4180 のエスケープ、逐次追記
│  │  ├─ raw.ts              # 生 JSON の gzip 保存、index.csv
│  │  └─ state.ts            # 完了済みの記録(resume 用)
│  ├─ progress.ts            # 進捗表示、サマリ
│  ├─ logger.ts              # ログファイル、機密値のマスク
│  └─ pipeline.ts            # 収集 → 計測 → 集約 → 出力の流れ
├─ test/
│  ├─ unit/
│  ├─ integration/           # Lighthouse を実際に起動する(遅い)
│  └─ fixtures/              # sitemap、LHR のサンプル
├─ package.json
├─ tsconfig.json
└─ README.md
```

## 4. 出力ディレクトリ構成

```text
output/<実行ID>/
├─ results.csv        # 最終成果物(F4)
├─ columns.json       # 確定した列定義(resume 時に再利用)
├─ state.jsonl        # 完了した (url, strategy) の記録(F2-8)
├─ urls.txt           # 収集した URL 一覧(F1-6)
├─ run.log            # 詳細ログ(F5-2)
└─ raw/
   ├─ index.csv       # URL と raw ファイルの対応(F6-3)
   ├─ mobile/<hash>-run1.json.gz
   └─ desktop/...
```

実行 ID は `YYYYMMDD-HHmmss` とする。`--output` で CSV のパスを指定した場合も、`raw` などの付随ファイルは同じ実行 ID のディレクトリに置く。

## 5. 主要な設計判断

### 5.1 列の確定(F4-7)

- CSV の列は、固定列(メタ情報、スコア、主要メトリクス、JSON 列)と、audit 由来の動的列に分かれる。
- audit の ID 一覧は、最初に成功した計測結果の `audits` から取り、`columns.json` に保存する。
- 以降の行は `columns.json` の列だけを出力する。未知の audit が現れた場合は警告ログに残して無視する。
- resume 時は既存の `columns.json` を読み込み、列を変えない。
- 動的列は ID の辞書順に並べ、実行ごとの並び順の揺れを防ぐ。
- 全 URL が失敗して列を確定できない場合は、固定列のみで出力する。

### 5.2 中央値と代表 run(F3)

- 数値の列(スコア、メトリクス)は、成功した run の中央値を取る。run 数が偶数の場合は中央 2 件の平均とする。
- 代表 run は、Performance スコアが中央値に最も近い run とする。同値の場合は先に実行した run を採る。
- `failed_audits`、`opportunities_json`、`diagnostics_json`、`final_url`、`raw_path` は代表 run の値を使う。
- 数値でない値(`null`、情報のみの audit)は、値のある run だけで中央値を取る。全 run が `null` なら空欄にする。
- `status` は、全 run 成功なら `ok`、一部成功なら `partial`、全失敗なら `error`。

### 5.3 計測の実行(F2)

- 1 計測ごとに Chrome を新規に起動し、終了時に必ず `kill()` する。状態の持ち越しによるぶれを避けるためである。
- 並列数が 1 より大きい場合は、計測ごとに別のポートで Chrome を起動する。
- モバイルは Lighthouse の既定設定、デスクトップは `desktop` プリセット(`lighthouse/core/config/desktop-config.js`)を使う。
- ヘッダー、User-Agent、ベーシック認証は `extraHeaders` と設定の `emulatedUserAgent` で渡す。
- タイムアウトは `maxWaitForLoad` と、全体を包む外側のタイマーの二重で守る。外側で打ち切った場合は Chrome を強制終了する。
- リトライは指数的に待ち時間を増やす。リトライ対象は、タイムアウトと接続エラー。HTTP 4xx/5xx など、再試行しても結果が変わらないものは対象外とする。

### 5.4 resume(F2-8)

- 完了した (URL, strategy) を、集約済みの行と一緒に `state.jsonl` へ 1 行ずつ追記する。
- `--resume [実行ID]` を付けると、`state.jsonl` を読んで完了分をスキップする。実行 ID を省略した場合は、`output/` 配下で最新のものを使う。
- 追記は 1 件ずつ `fsync` まで行わず、行単位の書き込みで済ませる。途中で壊れた最終行は、読み込み時に無視する。
- `results.csv` への追記と `state.jsonl` への追記は、`results.csv` を先にする。resume 時は `state.jsonl` を正とし、`results.csv` に重複行がある場合は起動時に除去する。

### 5.5 機密情報の扱い(F7)

- 認証情報は環境変数からのみ読み込み、設定オブジェクトには `Authorization` ヘッダーの形で保持する。
- ロガーは、既知の機密値(認証情報、`--header` の値)を出力前に `***` へ置換する。
- 生 JSON の `configSettings.extraHeaders` に認証情報が残るため、保存前に取り除く。
- 機密値のマスクは、ユニットテストで漏れを検証する(AC10)。

### 5.6 負荷配慮

- URL 間の待機(`--delay`)は、計測の完了から次の開始までの待ち時間とする。
- 同一ホストに対する同時リクエストは `--concurrency` を上限とする。

## 6. フェーズ

### Phase 0: プロジェクト初期化

- `package.json`、`tsconfig.json`(ESM、strict)、`eslint`、`prettier`、`vitest` を用意する。
- `npm run dev`(`tsx`)、`build`、`test`、`test:integration`、`lint` のスクリプトを定義する。
- `.gitignore` に `output/` と `node_modules/` が含まれていることを確認する。
- README の骨子を作る(目的、使い方、許可のあるサイトにのみ実行する旨)。

完了条件: `npm run lint` と `npm test`(空でも)が通る。

### Phase 1: URL 収集(F1)

- `sitemap/parse.ts`: `urlset` と `sitemapindex` を判別して解析する。
- `sitemap/discover.ts`: 指定 URL がルートなら `/sitemap.xml` を試し、無ければ `robots.txt` の `Sitemap:` 行を探す。
- `sitemap/collect.ts`: index を再帰的に辿る。循環参照の防止(訪問済みの管理)と、深さの上限を設ける。`.xml.gz` の sitemap も解凍して扱う。
- `url/normalize.ts`: フラグメント除去、ホスト名の小文字化、既定ポートの除去、末尾スラッシュの扱いを統一する。
- `url/filter.ts`: `--include` / `--exclude`(glob)、`--limit`。
- `urls.txt` への保存と、件数の表示。

テスト: 単体テストで、sitemap の各形式、index の再帰、循環、重複除去、正規化、フィルタを検証する。

完了条件: 実在の sitemap で、`--limit` 付きの URL 一覧が表示・保存される(AC1)。

### Phase 2: 1 URL の計測と行の抽出(F2 の一部、F5 の一部)

- `lighthouse/options.ts`: mobile / desktop の設定を組み立てる。
- `lighthouse/runner.ts`: Chrome の起動、計測、終了を行う `runOnce(url, strategy)`。
- `aggregate/extract.ts`: LHR から、スコア、主要メトリクス、全 audit の `score` と `numericValue`、`failed_audits`、`opportunities_json`、`diagnostics_json` を取り出す。
  - Opportunities と Diagnostics は、`details.type === 'opportunity'` の audit と、`group === 'diagnostics'` の audit で分ける。
  - `items` は肥大化するため、1 audit あたりの件数の上限を設ける(既定 50 件。超過分は `truncated: true` を付ける)。
- 実際の LHR を 1 件保存して `test/fixtures/` に置き、`extract.ts` のテストに使う。

完了条件: 1 URL を指定すると、モバイル・デスクトップ各 1 回の行がコンソールに JSON で出る。

### Phase 3: 複数回測定・集約・CSV 出力(F2、F3、F4)

- `lighthouse/retry.ts`: リトライとタイムアウト(5.3)。
- `aggregate/median.ts`: 中央値と代表 run の選択(5.2)。
- `output/columns.ts`: 列定義と `columns.json`(5.1)。
- `output/csv.ts`: RFC 4180 のエスケープ、BOM オプション、逐次追記。
- `pipeline.ts`: URL × strategy のループ、`--concurrency`、`--delay`。
- 失敗時の行(`status=error`、`error_message`)の出力。

テスト: 中央値(奇数・偶数・欠損・全失敗)、CSV のエスケープ(カンマ、改行、引用符、JSON 文字列)、列の固定。

完了条件: 数 URL の sitemap から、`results.csv` が出力される(AC2、AC3、AC4、AC6、AC7、AC8)。

### Phase 4: raw バックアップ・resume(F6、F2-8)

- `output/raw.ts`: 全 run の LHR を gzip で保存し、`index.csv` を更新する。`raw_path` を行に反映する。
- 保存前の機密情報の除去(5.5)。
- `output/state.ts`: `state.jsonl` の追記と読み込み、`--resume`(5.4)。
- 途中で強制終了した後の再開を手動で確認する。

完了条件: 計測の途中で中断し、`--resume` で残りだけが実行される(AC5、AC9)。

### Phase 5: アクセス制御への対応・進捗表示・仕上げ(F5、F7)

- `--header`、`--user-agent`、ベーシック認証(環境変数)の実装。
- `logger.ts` の機密値マスク。
- 進捗表示(完了数 / 総数、経過時間、残り時間の目安)と、終了時のサマリ。
- ベーシック認証付きのローカルテストサーバーで、認証が通ることと、情報が出力に残らないことを確認する(AC10)。
- README を仕上げる(オプション一覧、CSV 列の説明、`columns.json` の意味、ビューワーとの契約)。

完了条件: 要件の受け入れ基準 AC1〜AC10 を全て確認できる。

## 7. テスト計画

| 種類 | 内容 | 実行 |
| --- | --- | --- |
| 単体 | sitemap 解析、URL 正規化・フィルタ、`extract`、中央値、CSV エスケープ、列の固定、機密値のマスク、state の読み書き | 常時 |
| 結合 | ローカルの静的サーバー(sitemap 付き、ベーシック認証付き)を立て、実際に Lighthouse を実行する。URL 数 2、runs 2 の小規模構成 | `npm run test:integration`(手動、または CI の別ジョブ) |
| 手動 | 実サイトでの `--limit 5` の実行。resume の中断・再開 | 各フェーズの完了時 |

受け入れ基準との対応:

| 基準 | 確認するフェーズ・方法 |
| --- | --- |
| AC1 | Phase 1 の手動確認、sitemap の単体テスト |
| AC2, AC3 | Phase 3 の結合テスト |
| AC4 | Phase 3 の結合テスト(存在しない URL を混ぜる) |
| AC5 | Phase 4 の手動確認 |
| AC6 | Phase 3 の CSV 単体テスト、Excel での手動確認 |
| AC7, AC8 | Phase 3 の `extract` と CSV の単体テスト |
| AC9 | Phase 4 の結合テスト |
| AC10 | Phase 5 の結合テスト |

## 8. リスクと対策

| リスク | 影響 | 対策 |
| --- | --- | --- |
| Lighthouse のバージョン更新で audit が増減する | 列が変わり、ビューワーが壊れる | `columns.json` で実行内の列を固定し、CSV に `lighthouse_version` と `schema_version` を残す。依存のバージョンは固定する |
| 計測が Chrome のハングで止まる | 全体が進まない | 外側のタイマーで強制終了し、リトライに回す |
| 並列実行で計測値がばらつく | 結果の信頼性が下がる | 既定は直列とし、並列化は利用者の判断とする。README に注意を書く |
| 大量の raw JSON でディスクを圧迫する | 保存失敗 | gzip 圧縮、`--no-raw`、開始時に件数と概算サイズを表示する |
| `opportunities_json` / `diagnostics_json` の肥大化 | CSV が重くなる | `items` の件数上限(Phase 2)を設ける。完全な情報は raw に残る |
| sitemap の URL がステージング環境のホストを指している | 意図しないサイトを計測する | 収集した URL のホストが指定サイトと異なる場合は警告し、既定では除外する(`--allow-external-hosts` で許可) |
| 認証情報の漏洩 | 機密の流出 | 環境変数のみ、マスク、raw からの除去、テストで検証(5.5) |

## 9. 着手前に決めること

要件の未確定事項のうち、次の 2 点は実装中に決める。

1. Node.js の最低バージョン: Phase 0 で、導入する Lighthouse の `engines` を確認して確定する。
2. Chrome の取得方法: システムにインストールされた Chrome を使う(`chrome-launcher` の既定)。同梱はしない。`CHROME_PATH` で上書きできる。

並列計測の精度(要件の未確定事項 1)は、既定を直列にして先送りする。実装後に、同一 URL を直列と並列で計測して差を確認する。

## 10. 範囲外(確認)

- ビューワーの開発
- sitemap を持たないサイトのクロール
- 定期実行・CI 連携・結果の時系列比較
