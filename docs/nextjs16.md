# Next.js 16 メモ（実装時の必須注意）

このプロジェクトは Next.js 16.2.9。学習データ（〜15）と破壊的変更があるため、迷ったら
`node_modules/next/dist/docs/01-app/` の該当ガイドを読むこと（特に `02-guides/upgrading/version-16.md`）。

## 非同期化された Request API（最重要）

`cookies()` / `headers()` / `params` / `searchParams` はすべて **async**。

```ts
// Server Component / Route Handler / Server Action
const cookieStore = await cookies();
const h = await headers();

export default async function Page(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  const { id } = await props.params;
  const sp = await props.searchParams;
}
```

Client Component では `use(params)`（React の `use` フック）で解決する。

## Middleware → Proxy

- `middleware.ts` は廃止 → **`proxy.ts`**（このプロジェクトは `src/proxy.ts`）。
- 関数名も `proxy` に。`export function proxy(request: NextRequest) {}`。
- ランタイムは **nodejs 固定**（edge 非対応）。よって service_role 等の Node 前提コードも書ける。
- 設定フラグ改名: `skipMiddlewareUrlNormalize` → `skipProxyUrlNormalize`。

## Server Actions

- `'use server'`（ファイル先頭 or 関数先頭）。常に `async`。
- 引数は `FormData`、または Client から `.bind(null, arg)`。
- 関数内で必ず認証確認（`supabase.auth.getUser()`）。
- 戻り値は serialize 可能な値のみ（生の DB レコードを返さない）。

## Route Handlers（cron バッチ）

- `POST` 等の変更系は常に動的。`GET` が `cookies()/headers()` を使うと動的化。
- cron 保護:
  ```ts
  export const maxDuration = 60; // Vercel
  export async function POST(req: Request) {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (token !== process.env.CRON_SECRET)
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    // ...batch
  }
  ```

## fetch / キャッシュ

- 明示が安全: `fetch(url, { cache: "no-store" })` / `{ next: { revalidate: 60 } }`。
- `revalidateTag` は第2引数（cacheLife profile）が必要になった。

## 廃止/改名（抜粋）

- `next lint` 廃止 → `eslint` 直接実行。
- `serverRuntimeConfig` / `publicRuntimeConfig` 廃止 → 環境変数へ。
- AMP サポート削除。
