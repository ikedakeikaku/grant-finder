# grant-finder 引き継ぎ（HANDOFF）

> 次セッションはこの文書 + `CLAUDE.md` + メモリ（データ落とし穴・並列セッション注意）を読んで続行する。

## これは何
事業者が事業情報・関心分野を登録すると、その年の有望な補助金を提案し、公募が近づくとメールで通知するサービス。jGrants公開APIの「今出ている補助金」＋**予算/例年パターンで公募開始前に予告**するのが差別化。補助金申請受託（池田計画）の集客入口。

## 稼働中インフラ（すべて設定済み・確認済み）
- **GitHubリポジトリ**: `github.com/ikedakeikaku/grant-finder`（**private**、origin設定済み、main push済み）
- **GitHub Actions**: `daily-pipeline` が**毎日06:00 JST自動実行**（取込→キュレーション→予測→マッチ→通知）。手動は `gh workflow run daily-pipeline`。初回実行は緑で完走・本番DB更新を確認済み。
  - Secrets登録済み: `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `ANTHROPIC_API_KEY`。**`RESEND_API_KEY`は未設定**（通知はdry-run）。
  - Variables: `JGRANTS_*`（キーワードは観光/脱炭素/創業/デジタル/支援/促進まで拡充済み）、`NOTIFY_FROM_EMAIL`、`APP_BASE_URL`(=localhost仮)。
- **Supabase**: プロジェクト稼働中。スキーマ＋RLS適用済み（`supabase/migrations/0001_init.sql`）。登録ユーザー: `plan@ikedakeikaku.jp`。
- **鍵は安全**: コード・git履歴に実鍵なし（`.env.local`はgit管理外）。一度ローカルファイルに鍵が貼られたが未コミット・未push・GitHub未到達で回収済み（ユーザーはローテーション不要と判断）。

## アーキテクチャ / 日次パイプライン
`scripts/`（tsx）: **ingest → seed(キュレーション) → predict → matches → notify**
- `ingest-jgrants.ts`: jGrants一覧(8+α keyword, 受付中)→詳細→`subsidies`へupsert。`raw`は添付base64を除去。終了済み含む履歴(acceptance=0, list-only)を`subsidy_schedules`へ蓄積。締切超過を`closed`に更新（鮮度）。登録事業者の所在地名でも検索（自治体補助金）。
- `seed-curated.ts`: `src/lib/curated.ts`の公式日程で主要制度を上書き（jGrantsの締切が不正確なため）。現状**ものづくりのみ**登録。現在公募なしなら予測へ。
- `build-predictions.ts`: `subsidy_schedules`を制度ごとに集計し例年の公募月から次回を予測→`subsidy_predictions`。※PostgREST1000行上限のためページネーション必須。
- `build-matches.ts`: 全事業者×受付中補助金で `syncMatchesForBusiness`（open）＋`syncPredictedMatchesForBusiness`（predicted）。
- `process-notifications.ts`: 締切30/14/7日前通知＋**予測の公募開始60日前にpre_announce**。

マッチの核（`src/lib/`）:
- `core/matching.ts`(pure): 地域(都道府県+市区町村)/業種/規模ゲート＋目的/関心/地元スコア。
- `matching/relevance.ts`: **LLM関連性ランカー(Claude Haiku 4.5, temperature:0)**。全国・全業種の汎用補助金から事業内容に関連するものを厳選（原子力等のノイズ除去）。閾値0.5。
- `matching/sync.ts`: 候補プール→LLM再ランク→matches upsert。予測は他県限定除外＋関連ヒント優先で上位80件に絞ってLLM。
- `core/{deadline,notify-plan,prediction,offering,dedupe,constants}.ts`(pure・全テスト付き)。

## 現在のデータ状態（2026-06-20時点）
- subsidies ≈ 299件 / active予測 ≈ 279件 / 登録事業者=池田計画（山梨県・サービス業・DX/省力化）。
- 山梨県固有の補助金はjGrants側に現在0件（データ供給の問題、コードは対応済み）。
- IT導入/持続化/省力化/ものづくりは現在非公募→予測側に表示。

## 重要な設計判断・落とし穴（詳細はメモリ `grant-finder-data-gotchas`）
- jGrantsの`acceptance_end`は複数回次制度で実締切と不一致→`curated.ts`で上書き。
- PostgRESTは既定1000行→大テーブルは`.range()`でページネーション。
- LLM関連性は`temperature:0`で安定化。予測の事前フィルタは信頼度だけで切らない（関連ヒント優先）。
- 並列セッションが同ディレクトリで作業し得る→scaffold/上書き前に`git status`確認（メモリ `parallel-sessions-check-dir`）。

## ⚠️ 未コミットの作業（要レビュー・私の作業ではない）
作業ツリーに**セキュリティ強化と思われる未コミット変更**あり（別セッション/ユーザー由来）。`git status`/`git diff`で確認してから扱うこと。勝手にコミット/破棄しない：
- 新規: `supabase/migrations/0002_security_hardening.sql`, `src/lib/url.ts`+test, `src/lib/validation.test.ts`
- 変更: `package.json`(pnpm.overrides postcss), `0001_init.sql`(notification_status に`processing`追加), `src/lib/supabase/admin.ts`(ブラウザガード), `process-notifications.ts`, `dashboard/page.tsx`, `login/actions.ts`, `render.ts`+test, `validation.ts`, `auth/callback/route.ts`
- 注意: `0002`や`0001`のenum追加は**ライブDBに適用済みとは限らない**（migrationファイル編集≠DB反映）。コードが`processing`を使うなら`ALTER TYPE`が要る。

## ローカル開発 / よく使うコマンド
- `pnpm dev`（http://localhost:3000）/ `pnpm lint && pnpm typecheck && pnpm test`（CIと同じ）/ `pnpm build`
- 手動パイプライン: `pnpm ingest` → `pnpm seed` → `pnpm predict` → `pnpm matches` → `pnpm notify`
- **ログイン（メール制限回避）**: Supabase Authの組み込みメールは1時間数通制限。admin APIで管理リンク発行可: `auth.admin.generateLink({type:"magiclink", email, options:{redirectTo:"http://localhost:3000/auth/callback"}})`。本番はカスタムSMTP(Resend)で解消。

## 次の一手（優先順）
1. **Resend設定**: Resendでドメイン認証→APIキー→`gh secret set RESEND_API_KEY`＋Supabase Auth SMTP設定。通知が実メール化＆認証メール制限も解消。
2. **Vercelデプロイ**（公開）: Next.jsをVercelへ→公開URL→`gh variable set APP_BASE_URL`を本番URLに。env(anon/service_role/Anthropic/Resend)をVercelに設定。重い日次バッチはGitHub Actions側のまま。
3. **キュレーション拡充**: 持続化/IT導入/省力化/事業承継の公式日程を`curated.ts`へ（要Web調査＋ユーザー確認）。
4. **地元自治体補助金のClaude発掘**（jGrantsの穴埋め・市区町村起点）。
5. **UX**: 登録なしで結果表示→通知だけ登録（摩擦低減、前回ユーザーが提起）。
6. （任意）GitHub Actions の Node20非推奨警告（動作影響なし）。

## ユーザーに確認待ち
- 「予測は締切60日前に1回目」を**「予測公募開始の60日前にpre_announce」**と解釈し実装済み。締切60日前の追加要否は未確認。
- 公開リポジトリ化はリスク低（鍵なし確認済み）。今はprivate。

## 連絡（ユーザー＝池田哲郎/池田計画）
山梨拠点の補助金申請受託コンサル。Vibe Coding方針（枯れたツール・pure＋テスト・短いCLAUDE.md・PR細かく・相互レビュー・最新情報は裏取り・dateコマンド）に沿う。
