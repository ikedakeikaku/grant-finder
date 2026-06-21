# Security Operations

公開・運用時の確認項目です。コード側では未承認リードを `lead_status = 'pending_review'` にし、承認済みの事業者だけを提案生成・通知対象にします。

## Supabase

- `SUPABASE_SERVICE_ROLE_KEY` は GitHub Actions / Vercel / ローカル `.env.local` のサーバー側だけに置く。
- `private` schema を API exposed schemas に追加しない。
- RLS を無効化しない。
- リード承認は `/admin/leads` を使う。
- SQL Editor で詳細確認する場合は `private.leads` を見る。

```sql
select *
from private.leads
order by signed_up_at desc;
```

承認する場合:

```sql
update public.businesses
set lead_status = 'approved',
    approved_at = now(),
    proposal_status = 'pending'
where id = '<business_id>';
```

停止する場合:

```sql
update public.businesses
set lead_status = 'suspended'
where id = '<business_id>';
```

## GitHub / Vercel

- GitHub Actions は workflow の `permissions: contents: read` を維持する。
- Actions secrets は必要最小限にする。
- Vercel の client 側に出る環境変数は `NEXT_PUBLIC_*` だけにする。
- Vercel に `ADMIN_EMAILS` を設定し、管理者のログインメールだけをカンマ区切りで入れる。
- 本番 `APP_BASE_URL` は `https://...` にする。

## Cost Controls

- Anthropic: monthly spend limit と usage alert を設定する。
- Resend: domain 認証後に送信上限と失敗通知を確認する。
- Supabase: usage alerts を設定し、service role key を共有しない。

## Abuse Controls

- 初期公開時は承認制で運用する。
- 承認・停止は `/admin/leads` で行う。
- CAPTCHA を入れる場合は Supabase Auth の CAPTCHA 設定または Cloudflare Turnstile を使う。
- 大量登録が見えたら該当 `businesses.lead_status` を `suspended` にする。
