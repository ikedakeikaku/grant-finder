"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseProfileForm, toBusinessRow } from "@/lib/validation";
import {
  fetchOpenSubsidiesForMatch,
  syncMatchesForBusiness,
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
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  let businessId: string;
  if (existing) {
    const { error } = await supabase
      .from("businesses")
      .update(row)
      .eq("id", existing.id);
    if (error) return { error: `保存に失敗しました: ${error.message}` };
    businessId = existing.id as string;
  } else {
    const { data: inserted, error } = await supabase
      .from("businesses")
      .insert(row)
      .select("id")
      .single();
    if (error) return { error: `保存に失敗しました: ${error.message}` };
    businessId = inserted.id as string;
  }

  // 登録直後に提案を表示できるよう、即マッチを生成（失敗しても保存は妨げない）。
  try {
    const admin = createSupabaseAdminClient();
    const subsidies = await fetchOpenSubsidiesForMatch(admin);
    await syncMatchesForBusiness(
      admin,
      {
        id: businessId,
        industry: parsed.data.industry,
        prefecture: parsed.data.prefecture,
        employee_count: parsed.data.employeeCount,
        purposes: parsed.data.purposes,
        interests: parsed.data.interests,
      },
      subsidies,
    );
  } catch (e) {
    console.error("[profile] マッチ生成に失敗(cronで再生成されます):", e);
  }

  revalidatePath("/dashboard");
  redirect("/dashboard");
}
