# grant-finder 引き継ぎ（HANDOFF）

> 次セッションはこの文書 + `CLAUDE.md` + メモリ（データ落とし穴・並列セッション注意）を読んで続行する。

## これは何
事業者が事業情報・関心分野を登録すると、その年の有望な補助金を提案し、公募が近づくとメールで通知するサービス。jGrants公開APIの「今出ている補助金」＋**予算/例年パターンで公募開始前に予告**するのが差別化。補助金申請受託（池田計画）の集客入口。

## 稼働中インフラ（すべて設定済み・確認済み 2026-06-21）
- **GitHubリポジトリ**: `github.com/ikedakeikaku/grant-finder`（**private**、origin設定済み）
- **GitHub Actions**:
  - `daily-pipeline` 毎日06:00 JST: 取込→キュレーション→**制度マスタ反映→予測→マッチ→提案書生成→通知**。本番で全green完走確認済み。
  - `research-catalog` 毎週月曜05:00 JST: 制度マスタの予算動向・公募日程をWeb調査で巡回更新。
  - Secrets登録済み: `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `ANTHROPIC_API_KEY` / **`RESEND_API_KEY`（設定済み＝実メール送信可）**。
  - Variables: `JGRANTS_*`、**`NOTIFY_FROM_EMAIL`=「補助金ファインダー <onboarding@resend.dev>」**、`APP_BASE_URL`(=localhost仮、Vercel後に確定)。
- **Supabase**: 稼働中。migration **0001/0002/0003/0004 すべてライブDB適用済み**。登録事業者=池田計画。
  - 注: 提案書メールは現状 **Resend無料枠**のため送信元 `onboarding@resend.dev`・宛先はアカウント所有者のみ → 池田計画の `notify_email` を `ikedatetsuroh@gmail.com` に変更済み。独自ドメイン認証で他社送信が可能になる。
- **鍵は安全**: コード・git履歴に実鍵なし（`.env.local`はgit管理外）。

## アーキテクチャ（2層 — 詳細はメモリ `grant-finder-proposal-architecture`）
提案を「制度マスタ調査(低頻度・深い)」と「事業者への提案(高頻度・推論)」に分離した。
日次 `scripts/`（tsx）: **ingest → seed(curated) → seed:programs → predict → matches → proposals → notify**
- **制度マスタ `programs`**（`src/lib/catalog/programs.ts`＋`research-output.json`）: 提案の母集団。58制度（国14/東京11/大阪10/神奈川9/山梨14、active45・watch9・ended4）。並列Web調査＋検証で作成。`scripts/research-catalog.ts`(Sonnet 4.6+web_search)が予算動向/日程を巡回更新し`budget_signals`投入。
- **提案エンジン `src/lib/matching/proposer.ts`**（Sonnet 4.6, relevance.ts後継）: profile×programs を読み「使える根拠・使えるか・準備物・時期・出典」を構造化出力。deep(Web)/light。`scripts/build-proposals.ts`が `proposals`＋`matches(kind=catalog)` を生成（pending=deep / 30日超=light / 直近readyはスキップ）。
- **関心駆動の制度発掘 `src/lib/catalog/discover.ts`**（Sonnet 4.6+web_search）: build-proposals の **deepモードのみ**、登録者の関心（観光/雇用・人材/脱炭素 等）に合致するが未収録の制度をWeb調査で発掘→`programs`に永続化(source='discovered')→候補に合流。これで「カタログにある分しか提案しない」を脱し、需要からカタログが育つ。厚労省の**助成金**(キャリアアップ/人材開発支援/業務改善 等)・観光庁・自治体制度も拾う（スモーク確認済み）。
- **通知**（`process-notifications.ts`＋`render.ts`）: `proposal_digest`(初回＋約月次・複数カード・控えめCTA)、catalog/予測の `next_open_from` 60日前 `pre_announce`、live(open)の締切30/14/7日前。重複は0004のDB制約＋25日ガードで防止。
- 既存の live 経路（`ingest`/`build-matches`(kind=open)/`build-predictions`/`curated.ts`(jGrants抑制)）も併存。
- core pure: `core/{matching,deadline,notify-plan,prediction,offering,dedupe,constants}.ts`（全テスト付き）。`matching/relevance.ts`は旧ランカー（proposerへ移行済み・未使用化）。

## 現在のデータ状態（2026-06-21時点）
- programs 58件、提案書(proposals) 池田計画ぶん生成済み（創業優先で7件、要件に基づく正直な除外あり）。catalog matches 7件。
- 提案書メールの**実送信成功済み**（ikedatetsuroh@gmail.com、Resend）。日次リハーサルも全green。
- **カバレッジの穴**: 厚労省の雇用/人材系**助成金**は未収録(0件)、観光庁系もほぼ未収録(1件のみ)。IT導入等も要確認 → 拡充候補（下記「次の一手」）。

## 重要な設計判断・落とし穴（詳細はメモリ `grant-finder-data-gotchas`）
- jGrantsの`acceptance_end`は複数回次制度で実締切と不一致→`curated.ts`で上書き。
- PostgRESTは既定1000行→大テーブルは`.range()`でページネーション。
- LLM関連性は`temperature:0`で安定化。予測の事前フィルタは信頼度だけで切らない（関連ヒント優先）。
- 並列セッションが同ディレクトリで作業し得る→scaffold/上書き前に`git status`確認（メモリ `parallel-sessions-check-dir`）。
- **Web検索ツール `web_search_20260209` の注意**: 内部でコード実行を使う。長時間化するため `client.messages.stream(...).finalMessage()`（非streamingは数分でタイムアウト）。`pause_turn` 継続時は **`container: res.container?.id` を次リクエストに渡す**（無いと `container_id is required ...` で400）。構造化出力が多いと max_tokens 切れで空になるので **16k程度**確保。proposer/discover/research-catalog 全てこの実装。

## 未コミット作業の状況
旧HANDOFFにあった「セキュリティ強化の未コミット変更」（0002・url/validation/admin guard 等）は **PR #1（feat/proposal-engine-catalog）で提案エンジンと一緒にコミット・main マージ済み**。0002/0003/0004 もライブDB適用済み。作業ツリーは概ねクリーン（`.env.local` のみ git管理外）。次セッションは通常どおり `git status` 確認のうえ進めてよい。

## ローカル開発 / よく使うコマンド
- `pnpm dev`（http://localhost:3000）/ `pnpm lint && pnpm typecheck && pnpm test`（CIと同じ）/ `pnpm build`
- 手動パイプライン: `pnpm ingest` → `pnpm seed` → `pnpm predict` → `pnpm matches` → `pnpm notify`
- **ログイン（メール制限回避）**: Supabase Authの組み込みメールは1時間数通制限。admin APIで管理リンク発行可: `auth.admin.generateLink({type:"magiclink", email, options:{redirectTo:"http://localhost:3000/auth/callback"}})`。本番はカスタムSMTP(Resend)で解消。

## 次の一手（優先順）
1. **カタログ拡充（任意）**: 厚労省助成金/観光庁/IT導入 等は登録者の関心に応じ **discover.ts が自動発掘** するため必須ではない。よく出る分野を事前に厚くしたい場合のみ、workflowでバルク調査→`research-output.json`統合→`pnpm seed:programs`。
2. **Resend独自ドメイン認証**: 専用サブドメインを認証→`NOTIFY_FROM_EMAIL`を自社アドレスへ＋`gh variable set`。これで**他社にも送信可**・到達率向上。Supabase Auth のカスタムSMTP(Resend)も設定すると認証メール制限も解消。
3. **Vercelデプロイ**（公開）: Next.jsをVercelへ→公開URL→`gh variable set APP_BASE_URL`を本番URLに。envをVercelに設定。重い日次バッチはGitHub Actions側のまま。
4. **予測の制度マスタ統合**: `build-predictions.ts` を programs.typical_schedule/budget_basis 駆動に寄せる（現状はjGrants履歴ベースが残存）。
5. **UX**: 登録なしで結果表示→通知だけ登録（摩擦低減）。「提案を準備中」表示の改善。
6. （任意）GitHub Actions の Node非推奨警告（動作影響なし）。

## ユーザーに確認待ち
- 「予測は締切60日前に1回目」を**「予測公募開始の60日前にpre_announce」**と解釈し実装済み。締切60日前の追加要否は未確認。
- 公開リポジトリ化はリスク低（鍵なし確認済み）。今はprivate。

## 連絡（ユーザー＝池田哲郎/池田計画）
山梨拠点の補助金申請受託コンサル。Vibe Coding方針（枯れたツール・pure＋テスト・短いCLAUDE.md・PR細かく・相互レビュー・最新情報は裏取り・dateコマンド）に沿う。
