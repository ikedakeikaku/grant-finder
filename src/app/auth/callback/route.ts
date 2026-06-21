import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildAppUrl, safeRelativePath } from "@/lib/url";

/**
 * マジックリンクのコールバック。?code= をセッションに交換して /dashboard へ。
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const { searchParams, origin } = requestUrl;
  const code = searchParams.get("code");
  const next = safeRelativePath(searchParams.get("next"), "/dashboard");

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(buildAppUrl(next, origin));
  }
  return NextResponse.redirect(buildAppUrl("/login?error=1", origin));
}
