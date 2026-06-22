import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin/access";
import { buildAppUrl, safeRelativePath } from "@/lib/url";

/**
 * マジックリンクのコールバック。?code= をセッションに交換して遷移する。
 * 行き先が明示されていない場合、管理者は管理画面(/admin/leads)、
 * 一般ユーザーは提案ダッシュボード(/dashboard)へ振り分ける。
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const { searchParams, origin } = requestUrl;
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next");
  const next = safeRelativePath(rawNext, "/dashboard");

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // next が未指定なら、管理者はログイン後に管理画面へ送る。
      if (!rawNext) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (isAdminEmail(user?.email)) {
          return NextResponse.redirect(buildAppUrl("/admin/leads", origin));
        }
      }
      return NextResponse.redirect(buildAppUrl(next, origin));
    }
  }
  return NextResponse.redirect(buildAppUrl("/login?error=1", origin));
}
