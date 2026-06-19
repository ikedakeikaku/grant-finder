"use server";

import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface LoginState {
  error?: string;
  sent?: boolean;
}

/**
 * マジックリンク（パスワード不要）でログイン/新規登録を行う。
 * 入力メール宛にリンクを送り、/auth/callback でセッションを確立する。
 */
export async function sendMagicLink(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "メールアドレスを入力してください" };

  const supabase = await createSupabaseServerClient();
  const hdrs = await headers();
  const origin =
    hdrs.get("origin") ?? process.env.APP_BASE_URL ?? "http://localhost:3000";

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) return { error: error.message };
  return { sent: true };
}
