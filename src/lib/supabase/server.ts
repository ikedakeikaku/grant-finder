import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server Component / Server Action / Route Handler 用の Supabase クライアント。
 * ユーザーのセッション(Cookie)に基づき RLS が適用される。
 * Next.js 16 では cookies() は async のため await が必須。
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Component から呼ばれた場合は Cookie を書き込めない。
            // セッション更新は src/proxy.ts が担うため、ここでは無視してよい。
          }
        },
      },
    },
  );
}
