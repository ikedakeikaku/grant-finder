import { createClient } from "@supabase/supabase-js";

/**
 * サービスロール(service_role)で接続する管理クライアント。RLS をバイパスする。
 *
 * 用途: 取込・マッチ生成・通知などのバッチ処理(jobs/)や管理機能のみ。
 * ⚠️ Client Component やブラウザに絶対に渡さないこと(秘密鍵)。
 */
export function createSupabaseAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error("service_role クライアントはブラウザでは使用できません");
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください",
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
