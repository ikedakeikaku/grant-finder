"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAdminEmail } from "@/lib/admin/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function requireAdmin(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) {
    throw new Error("管理者権限がありません");
  }
}

function businessIdFrom(formData: FormData): string {
  const value = formData.get("businessId");
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new Error("businessId が不正です");
  }
  return value;
}

export async function approveLead(formData: FormData): Promise<void> {
  await requireAdmin();
  const businessId = businessIdFrom(formData);
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("businesses")
    .update({
      lead_status: "approved",
      approved_at: new Date().toISOString(),
      // 承認＝調査キューへ投入。/research-grants(定額) で深掘り調査する。
      // 従量APIの build-proposals は needs_research を skip するため二重課金にならない。
      proposal_status: "needs_research",
    })
    .eq("id", businessId);

  if (error) throw new Error("承認に失敗しました");
  revalidatePath("/admin/leads");
}

export async function suspendLead(formData: FormData): Promise<void> {
  await requireAdmin();
  const businessId = businessIdFrom(formData);
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("businesses")
    .update({ lead_status: "suspended" })
    .eq("id", businessId);

  if (error) throw new Error("停止に失敗しました");
  revalidatePath("/admin/leads");
}

export async function reviewLead(formData: FormData): Promise<void> {
  await requireAdmin();
  const businessId = businessIdFrom(formData);
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("businesses")
    .update({ lead_status: "pending_review", approved_at: null })
    .eq("id", businessId);

  if (error) throw new Error("再審査への変更に失敗しました");
  revalidatePath("/admin/leads");
}
