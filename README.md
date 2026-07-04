# Surprise University - Project 収支管理アプリ

SU- の年間イベント運営における「立替の記録と精算」「メンバーからの集金管理」「収支の可視化」を行うWebアプリ。
会計担当のスプレッドシート作業を、メンバー自身がスマホ・PCから直接入力・確認できる形に置き換える。

- 対象期間: 2026年6月〜2027年3月(年度単位で切り替え可能)
- データはすべてJSONファイルで管理(DBなし)
- ロールは 管理者(admin) / 一般(member) の2つ。共有ID/パスワード各1組のみ

## 構成

| レイヤ | 技術 |
|---|---|
| フロントエンド | Next.js (App Router) + TypeScript + Tailwind CSS |
| グラフ | Recharts(棒+折れ線の複合チャート) |
| バックエンド | FastAPI (Python) |
| データ | JSONファイル(`backend/data/`) |
| 認証 | HTTP Basic認証(admin / member の2クレデンシャル) |

```
su-finance/
├── backend/          # FastAPI(認証・CRUD・集計・CSV・監査ログ)
│   ├── main.py       # APIエンドポイント一式
│   ├── storage.py    # JSONファイル読み書き + GitHub同期(任意)
│   ├── seed_demo.sh  # デモデータ投入スクリプト
│   └── data/
│       ├── config.json        # 年度設定・イベント名候補
│       └── 2026/
│           ├── expenses.json     # 支出(立替)
│           ├── incomes.json      # 収入(入金)
│           ├── audit_log.jsonl   # 操作履歴(追記型)
│           └── receipts/         # 領収書ファイル(支出IDごと)
└── frontend/         # Next.js(表示に徹する。集計はすべてAPI側)
    └── app/
        ├── page.tsx           # ダッシュボード
        ├── login/             # ログイン
        ├── expenses/          # 支出一覧・登録
        ├── incomes/           # 収入一覧・登録
        ├── settlement/        # 精算一覧・一括精算(管理者)
        └── admin/             # CSVエクスポート・バックアップ・操作履歴(管理者)
```

## ローカルでの起動

### 1. バックエンド

```bash
cd backend
python3.12 -m venv .venv           # 初回のみ(Python 3.10以上)
.venv/bin/pip install -r requirements.txt   # 初回のみ
.venv/bin/uvicorn main:app --port 8000
```

### 2. フロントエンド

```bash
cd frontend
npm install        # 初回のみ
npm run dev        # http://localhost:3000
```

### 3. ログイン

デフォルトの認証情報(環境変数で必ず変更すること):

| ロール | ID | パスワード |
|---|---|---|
| 管理者 | `admin` | `su-admin` |
| 一般 | `member` | `su-member` |

ログインでは名前を入力しない。操作者名は支出・収入の登録フォームで入力した「支払者名/入金者名」を操作履歴に記録する(性善説運用)。

動作を試したいときは、バックエンド起動後に `./backend/seed_demo.sh` でデモデータを投入できる。

## 環境変数

バックエンド(`backend/.env.example` 参照):

| 変数 | 既定値 | 説明 |
|---|---|---|
| `ADMIN_USER` / `ADMIN_PASSWORD` | admin / su-admin | 管理者の共有クレデンシャル |
| `MEMBER_USER` / `MEMBER_PASSWORD` | member / su-member | 一般の共有クレデンシャル |
| `FISCAL_YEAR` | 2026 | 対象年度(データフォルダの切り替え) |
| `DATA_DIR` | backend/data | データ置き場 |
| `GITHUB_TOKEN` / `GITHUB_DATA_REPO` / `GITHUB_DATA_BRANCH` | (無効) | GitHub永続化(下記) |

フロントエンド:

| 変数 | 既定値 | 説明 |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | http://localhost:8000 | バックエンドAPIのURL |

## 主な機能と運用

- **支出(立替)**: 1レコード=1件の立替。月×支払者×精算状況×イベントで組み合わせフィルタでき、絞り込み中の合計を表示。「未精算のみ」ワンタップ切り替えあり。一般メンバーも全項目を編集できる(削除だけ管理者)。
- **領収書の添付**: 各支出に領収書(エビデンス)をアップロードできる。PDF・画像(PNG/JPEG/GIF/WebP/HEIC、1ファイル15MBまで)、複数添付可。一覧の「📎」から表示・追加・削除。ファイルは `data/{年度}/receipts/{支出ID}/` に保存され、GitHub永続化を有効にすると領収書もリポジトリへ同期される。
- **収入(集金)**: 1レコード=1人の入金。メンバーがPayPay等で送金→入金レコードを登録(未確認)→集金担当が「確認済」に変更、の2段階。**集計上の収入は確認済のみ計上**。一般メンバーは入金確認の変更のみ、その他項目の編集・削除は管理者のみ。
- **イベント名**(管理者): 登録フォームで選べるイベント名は固定リスト。管理タブから追加・名称変更・削除ができる。名称変更は既存レコードにも反映される(集計が分裂しない)。使用中のイベントは削除できない。
- **精算**(管理者): 未精算の立替を人別に集計した「誰にいくら渡すべきか」一覧。チェックして一括精算すると精算日が自動記録される。
- **ダッシュボード**: 未精算・未確認のアラート(タップで該当条件の明細へ遷移)、資金状況カード、月別収支の表+グラフ(収入棒グラフ+収支・収支率の折れ線)、イベント別収支。フィルタ条件はURLに反映されるので、条件付きのリンクを共有できる。
- **エクスポート**(管理者): 支出・収入・操作履歴のCSV(UTF-8 BOM付き、Excelでそのまま開ける)と、JSON一式のZIPバックアップ。
- **操作履歴**: 全ての登録・更新・削除を、操作者名・ロール・変更前後の値つきで `audit_log.jsonl` に追記記録。削除は論理削除(deletedフラグ)なので、履歴から復元できる。

## 年度切り替え

年度が変わったら環境変数 `FISCAL_YEAR=2027` を設定して再起動すると、`data/2027/` に新しいデータフォルダが作られる。過去年度のデータはそのまま残る。あわせて `data/config.json` の `start_month` / `end_month` を新年度の期間(例: `2027/06`〜`2028/03`)に更新すること。

## デプロイ(無料構成)

- **フロントエンド**: Vercel 無料枠。`frontend/` をルートに指定し、環境変数 `NEXT_PUBLIC_API_URL` にバックエンドのURLを設定。
- **バックエンド**: Render または Fly.io 無料枠。起動コマンドは `uvicorn main:app --host 0.0.0.0 --port $PORT`。認証情報の環境変数を必ず設定する。

**重要**: 無料ホスティングのファイルシステムはエフェメラル(再デプロイ・再起動でファイルが消える)。対策として **GitHub永続化(案A・推奨)** を実装済み:

1. データ用のプライベートリポジトリを作る(例: `your-account/su-finance-data`)
2. そのリポジトリの Contents 権限(Read and write)を持つ Fine-grained personal access token を発行
3. バックエンドに `GITHUB_TOKEN` / `GITHUB_DATA_REPO` を設定

これで起動時にGitHubからデータを取得し、書き込みのたびにリポジトリの `data/` 配下へ自動プッシュされる。変更履歴がGitに残るため、バックアップと監査を兼ねる。

それでも念のため、管理画面の「JSON一式をバックアップ(ZIP)」を定期的に(月1回程度)手元に保存しておくことを推奨。

## API一覧

| メソッド/パス | 説明 | 権限 |
|---|---|---|
| `POST /login` | 認証・ロール判定 | 全員 |
| `GET /config` | 年度・月リスト・イベント/人の候補 | 全員 |
| `GET /events` | イベント名の一覧 | 全員 |
| `POST/PATCH/DELETE /events` | イベント名の追加・名称変更(レコードに反映)・削除 | 管理者 |
| `GET/POST /expenses`, `PATCH/DELETE /expenses/{id}` | 支出CRUD(クエリでフィルタ) | 削除は管理者 |
| `POST/GET/DELETE /expenses/{id}/receipts[/{name}]` | 領収書のアップロード・表示・削除 | 全員 |
| `GET/POST /incomes`, `PATCH/DELETE /incomes/{id}` | 収入CRUD(クエリでフィルタ) | 削除・確認以外の更新は管理者 |
| `GET /settlement`, `POST /settlement/settle` | 人別未精算集計・一括精算 | 管理者 |
| `GET /summary` | ダッシュボード用集計 | 全員 |
| `GET /export/{expenses,incomes,audit}` | CSV出力 | 管理者 |
| `GET /audit` | 操作履歴 | 管理者 |
| `GET /backup` | JSON一式ZIP | 管理者 |

フィルタ例: `GET /expenses?month=2026/07&payer=メンバーA&status=unsettled`
