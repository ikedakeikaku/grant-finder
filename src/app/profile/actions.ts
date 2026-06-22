"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseProfileForm, toBusinessRow } from "@/lib/validation";
import { notifyDiscord } from "@/lib/notifications/discord";
import { buildAppUrl } from "@/lib/url";
import {
  fetchOpenSubsidiesForMatch,
  fetchActivePredictions,
  syncMatchesForBusiness,
  syncPredictedMatchesForBusiness,
} from "@/lib/matching/sync";

export interface ProfileState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

export async function saveProfile(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const parsed = parseProfileForm(formData);
  if (!parsed.success) {
    return {
      error: "入力内容を確認してください",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const row = toBusinessRow(parsed.data, user.id);

  // 1ユーザー1事業者を想定。既存があれば更新、なければ作成。
  const { data: existing } = await supabase
    .from("businesses")
    .select("id, lead_status")
    .eq("user_id", user.id)
    .maybeSingle();

  let businessId: string;
  let leadStatus = "pending_review";
  if (existing) {
    const { error } = await supabase
      .from("businesses")
      .update(row)
      .eq("id", existing.id);
    if (error) return { error: `保存に失敗しました: ${error.message}` };
    businessId = existing.id as string;
    leadStatus = (existing.lead_status as string | null) ?? "pending_review";
  } else {
    const { data: inserted, error } = await supabase
      .from("businesses")
      .insert(row)
      .select("id")
      .single();
    if (error) return { error: `保存に失敗しました: ${error.message}` };
    businessId = inserted.id as string;

    // 新規リードは運営へ即 Discord 通知（早期フォローのため）。
    // 失敗しても登録は妨げない。メール等の個人情報は載せず、詳細は管理画面で確認する。
    try {
      const d = parsed.data;
      await notifyDiscord(
        [
          "🆕 新規リード登録",
          `事業者: ${d.name}`,
          `業種: ${d.industry ?? "—"} / 地域: ${d.prefecture ?? "—"} / 従業員: ${d.employeeCount ?? "—"}`,
          `目的: ${d.purposes.length ? d.purposes.join("、") : "—"}`,
          `関心: ${d.interests.length ? d.interests.join("、") : "—"}`,
          `承認 → ${buildAppUrl("/admin/leads")}`,
        ].join("\n"),
      );
    } catch (e) {
      console.error("[profile] Discord通知に失敗:", e);
    }
  }

  if (leadStatus !== "approved") {
    revalidatePath("/dashboard");
    redirect("/dashboard");
  }

  // 提案書（制度マスタベース）はバッチ build-proposals が深掘り生成する。
  // 保存時に pending を立て、次回バッチで再生成させる（失敗しても保存は妨げない）。
  try {
    const admin = createSupabaseAdminClient();
    await admin
      .from("businesses")
      .update({ proposal_status: "pending" })
      .eq("id", businessId);
  } catch (e) {
    console.error("[profile] proposal_status 更新に失敗:", e);
  }

  // 登録直後にも live(jGrants) のマッチは即表示（失敗しても保存は妨げない）。
  try {
    const admin = createSupabaseAdminClient();
    const businessForMatch = {
      id: businessId,
      industry: parsed.data.industry,
      prefecture: parsed.data.prefecture,
      city: parsed.data.city,
      employee_count: parsed.data.employeeCount,
      purposes: parsed.data.purposes,
      interests: parsed.data.interests,
      planned_investment: parsed.data.plannedInvestment,
    };
    const [subsidies, predictions] = await Promise.all([
      fetchOpenSubsidiesForMatch(admin),
      fetchActivePredictions(admin),
    ]);
    await syncMatchesForBusiness(admin, businessForMatch, subsidies);
    await syncPredictedMatchesForBusiness(admin, businessForMatch, predictions);
  } catch (e) {
    console.error("[profile] マッチ生成に失敗(cronで再生成されます):", e);
  }

  revalidatePath("/dashboard");
  redirect("/dashboard");
}
