# アーキテクチャ

## 3層構成

1. **Web（Next.js 16 / Vercel）** — 公開LP、登録・ログイン（Supabase Auth）、ダッシュボード
   （提案・締切カレンダー）、管理画面（運営が登録ユーザー×マッチを閲覧）。
2. **データ/Auth（Supabase）** — Postgres + Auth + RLS。`supabase/migrations/` がスキーマの正本。
   ユーザー操作は RLS 経由（server/browser クライアント）。取込・マッチ生成・通知は
   サービスロール（`createSupabaseAdminClient`）で RLS をバイパス。
3. **ジョブ層（GitHub Actions cron + `scripts/`）** — 素のTSを tsx で実行。Vercel に依存せず
   ほぼ無料。ロジックは `src/lib/core/` の pure 関数に寄せ、スクリプトは I/O の薄い殻にする。

## 公募前把握（差別化の中核）

3つのデータソースを統合する:

1. **jGrants公開API（live）** — 毎日 `subsidies` に upsert。新規公募・締切接近を検知。
2. **例年パターン** — `subsidy_schedules`（過去の公募回次）から `subsidy_predictions` を算出。
   「例年◯月に始まる◯◯」を予告。
3. **予算動向** — `budget_signals`（概算要求/補正/当初）。v1は変更検知＋運営のキュレーション登録。

## データフロー

```
jGrants API ──(ingest)──> subsidies ──┐
                                       ├─(generate)─> matches ─(schedule)─> notifications ─(send)─> Email
businesses(登録) ─────────────────────┘
subsidies(履歴) ─(predict)─> subsidy_predictions ─(generate)─> matches(predicted)
budget_signals ─(予告補強)──────────────┘
```

## 詳細
- データモデル: `supabase/migrations/0001_init.sql`（コメント付きが正本）
- jGrants API: `docs/jgrants-api.md`
- Next.js 16 注意: `docs/nextjs16.md`
