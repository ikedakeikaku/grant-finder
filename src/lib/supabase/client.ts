"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Client Component 用の Supabase クライアント。
 * anon key を使い、RLS でユーザー自身のデータのみアクセス可能。
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
