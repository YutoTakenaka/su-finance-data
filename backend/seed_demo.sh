#!/bin/bash
# 動作確認用のデモデータを投入するスクリプト。
# 使い方: バックエンド起動後に ./seed_demo.sh
# リセット: printf '[]\n' > data/2026/expenses.json などでファイルを空にする
set -e
B=${API_URL:-http://localhost:8000}
AUTH=${ADMIN_AUTH:-admin:su-admin}

post() { curl -s -o /dev/null -w "%{http_code} $1\n" -u "$AUTH" -H 'Content-Type: application/json' -d "$2" "$B$1"; }

post /expenses '{"date":"2026-06-07","event":"6月キックオフ","payer":"竹中優斗","description":"会場費","amount":15000,"status":"settled","operator":"竹中優斗"}'
post /expenses '{"date":"2026-06-20","event":"6月懇親会","payer":"竹中優斗","description":"景品代","amount":6200,"operator":"竹中優斗"}'
post /expenses '{"date":"2026-07-05","event":"7月月例イベント","payer":"竹中優斗","description":"会場費","amount":30000,"status":"settled","operator":"竹中優斗"}'
post /expenses '{"date":"2026-07-18","event":"7月懇親会","payer":"メンバーB","description":"飲食代","amount":12300,"operator":"メンバーB"}'
post /incomes '{"date":"2026-06-05","event":"6月キックオフ","payer":"メンバーA","amount":3000,"confirmed":true,"operator":"メンバーA"}'
post /incomes '{"date":"2026-06-08","event":"6月キックオフ","payer":"メンバーB","amount":3000,"confirmed":true,"operator":"メンバーB"}'
post /incomes '{"date":"2026-07-01","event":"7月月例イベント","payer":"メンバーA","amount":15000,"confirmed":true,"operator":"メンバーA"}'
post /incomes '{"date":"2026-07-03","event":"7月月例イベント","payer":"メンバーB","amount":15000,"operator":"メンバーB"}'
post /incomes '{"date":"2026-07-03","event":"7月月例イベント","payer":"メンバーC","amount":15000,"operator":"メンバーC"}'
echo "done"
