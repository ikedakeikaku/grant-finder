#!/usr/bin/env bash
#
# GitHub Actions 用の Secrets を .env.local から登録する。
#  - あなた自身がローカルで実行してください（鍵の値は画面に出ません）。
#  - Claude はこのスクリプトを実行せず、.env.local を読みません。
#  使い方:  bash scripts/setup-github-secrets.sh
#
set -euo pipefail

ENV_FILE=".env.local"
if [ ! -f "$ENV_FILE" ]; then
  echo "✗ $ENV_FILE が見つかりません。プロジェクト直下で実行してください。"
  exit 1
fi

# GitHub Actions(daily.yml) が参照する秘密情報
SECRETS=(
  NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  ANTHROPIC_API_KEY
  RESEND_API_KEY
)

for key in "${SECRETS[@]}"; do
  # KEY="value" / KEY=value の両対応で値を取り出す（前後のクォートを除去）
  val="$(grep -E "^${key}=" "$ENV_FILE" | head -1 | sed -E "s/^${key}=//" | sed -E 's/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/')"
  if [ -z "$val" ]; then
    echo "⚠️  ${key} は未設定/空 → スキップ（あとで設定してください）"
    continue
  fi
  printf '%s' "$val" | gh secret set "$key"
  echo "✓ ${key} を登録しました"
done

echo ""
echo "=== 登録済み Secrets ==="
gh secret list
