# grant-finder

補助金・助成金の候補を事業者プロフィールに合わせて整理し、期限や公募見込みを通知する Next.js アプリです。jGrants の公開API、制度マスタ、予算動向、例年スケジュールを組み合わせて提案を作ります。

## Stack

- Next.js 16 / React 19 / TypeScript strict
- Supabase Auth + Postgres + RLS
- Vitest / ESLint / Prettier
- GitHub Actions cron
- Resend API によるメール送信

## Setup

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

`.env.local` は Git 管理外です。実鍵や個人のメールアドレスはコミットしないでください。

## Security Notes

- `NEXT_PUBLIC_SUPABASE_ANON_KEY` はブラウザへ公開される前提の anon key です。アクセス制御は Supabase RLS で行います。
- `SUPABASE_SERVICE_ROLE_KEY`、`ANTHROPIC_API_KEY`、`RESEND_API_KEY` はサーバー/Actions 専用です。
- `NOTIFY_FROM_EMAIL` は実送信時のみ設定してください。公開サンプルには実ドメインのメールアドレスを置きません。
- ユーザーの通知先メールアドレスはアプリDBに保存される個人情報です。ログや公開Issueへ貼らない運用にしてください。
- リード確認は Supabase の `private.leads` ビューを使います。通常ユーザーには公開しません。
- 本番 `APP_BASE_URL` は `https://...` を設定してください。

## Leads

Supabase SQL Editor で次のように確認します。`private` schema は API の exposed schemas に追加しないでください。

```sql
select *
from private.leads
order by signed_up_at desc;
```

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
pnpm audit --prod
pnpm build
```
