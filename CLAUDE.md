@AGENTS.md

# grant-finder

事業者が事業情報・関心分野を登録すると、その年の有望な補助金を提案し、公募が近づくとメールで通知するサービス。jGrants公開APIの「今出ている補助金」に加え、**予算動向＋例年パターンで公募開始前に予告する**のが差別化点。補助金申請受託の集客入口。

## スタック

- Next.js 16 (App Router, TS strict) / React 19 / Tailwind v4 — Vercel
- Supabase (Postgres + Auth + RLS) — `@supabase/ssr`
- メール: Resend（`src/lib/notifications/` の薄い抽象層経由・専用サブドメイン送信）
- 監視/通知バッチ: `scripts/` の素のTS（tsx）。GitHub Actions cron で実行
- Vitest（unit）/ ESLint + Prettier

## ディレクトリ

- `src/app/` … 画面（公開LP・登録・ダッシュボード・管理）
- `src/lib/core/` … pure関数（マッチング/スコア/締切/予測/名寄せ/公募判定）。**副作用なし・unit test必須**
- `src/lib/jgrants/` … jGrants APIクライアント＋型＋正規化
- `src/lib/matching/` … マッチ生成のDB連携(sync) と LLM関連性ランカー(relevance, Haiku 4.5)
- `src/lib/curated.ts` … 主要制度の公式日程（jGrantsが不正確なため上書き）
- `src/lib/supabase/` … server/client/admin クライアント
- `scripts/` … 日次パイプライン: ingest → seed(キュレーション) → predict → matches → notify
- `supabase/migrations/` … スキーマ＋RLS（SQL）
- `docs/` … 設計の詳細

## データ品質の注意（詳細はメモリ参照）

- jGrantsの`acceptance_end`は主要な複数回次制度では実際の申請締切と不一致 → `curated.ts`で上書き。
- 大きいテーブル(subsidy_schedules等)は PostgREST の1000行上限に注意し`.range()`で全件取得。
- LLM関連性は`temperature:0`で安定化。予測の事前フィルタは関連ヒント優先（信頼度だけで切らない）。

## Next.js 16 の必須注意（詳細: docs/nextjs16.md）

- `cookies()` `headers()` `params` `searchParams` は **async**。必ず `await`。
- Middleware は **`proxy`** にリネーム（`src/proxy.ts`、`export function proxy`、runtimeはnodejs固定）。
- `next lint` は廃止。`eslint` を直接実行（設定済み）。
- Route Handler の cron 保護は `Authorization: Bearer ${CRON_SECRET}` を検証。

## 規約

- TypeScript strict（`noUncheckedIndexedAccess` 有効）。型をきちんと定義する。
- 関数は短く、pure に。副作用（DB/HTTP/メール）は境界に分離し、コアはテスト可能に。
- DRY：マッチング/予測ロジックは `src/lib/core/` に集約。重複実装しない。
- DB書き込み・取込・通知は **サービスロール（`createSupabaseAdminClient`）**。ユーザー操作は RLS 前提で server/browser クライアント。
- 秘密鍵（service_role / RESEND_API_KEY）をクライアントに渡さない。
- 現在日付は `date` コマンドで取得。AIの知識を鵜呑みにせず公式docを裏取り。
- 出典表示: jGrants 由来データには「Jグランツポータル」出典を明記。

## 検証

- 変更後は `pnpm lint && pnpm typecheck && pnpm test` を回す（CIと同じ）。
- pure関数は境界値（締切0/7/14/30日、地域内外、規模上限ちょうど）をテスト。
- コミット/プッシュはユーザーの依頼時のみ。PR粒度は細かく。
