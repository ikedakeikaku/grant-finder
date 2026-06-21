"use server";

import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildAppUrl } from "@/lib/url";
import { parseLoginForm } from "@/lib/validation";

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
  const parsed = parseLoginForm(formData);
  if (!parsed.success) return { error: "メールアドレスの形式が不正です" };

  const supabase = await createSupabaseServerClient();
  const hdrs = await headers();
  const redirectTo = buildAppUrl("/auth/callback", hdrs.get("origin"));

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { emailRedirectTo: redirectTo },
  });
  if (error) return { error: error.message };
  return { sent: true };
}
