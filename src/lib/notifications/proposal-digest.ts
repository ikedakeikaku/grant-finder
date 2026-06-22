import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAppUrl, safeHttpUrl } from "../url";
import { createEmailSender } from "./mailer";
import {
  renderProposalDigestEmail,
  type ProposalEmailItem,
} from "./render";

export interface DigestSendResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
}

/**
 * 指定事業者の提案書ダイジェストを「いま」送信し、notifications に記録する。
 * 調査完了(import-research)直後の即時通知に使う。
 * - 送信条件（承認済み・通知ON・通知先あり・提案あり）を満たさなければ skip。
 * - ここで作る proposal_digest 行により、日次cron(process-notifications)の
 *   重複送信（初回＋月次のダイジェスト）は抑止される。
 * - 送信失敗時も notifications に failed を記録し、呼び出し側の処理は止めない想定。
 */
export async function sendProposalDigestNow(
  admin: SupabaseClient,
  businessId: string,
  now: Date,
): Promise<DigestSendResult> {
  const { data: biz, error: bErr } = await admin
    .from("businesses")
    .select("notify_email, name, lead_status, notifications_enabled")
    .eq("id", businessId)
    .maybeSingle();
  if (bErr) throw new Error(`businesses 取得失敗: ${bErr.message}`);
  if (!biz) return { ok: false, skipped: true, reason: "事業者なし" };

  const to = (biz.notify_email as string | null) ?? null;
  if (biz.lead_status !== "approved")
    return { ok: false, skipped: true, reason: "未承認" };
  if (!biz.notifications_enabled)
    return { ok: false, skipped: true, reason: "通知オフ" };
  if (!to) return { ok: false, skipped: true, reason: "通知先未設定" };

  const { data: proposal, error: pErr } = await admin
    .from("proposals")
    .select("summary, items")
    .eq("business_id", businessId)
    .maybeSingle();
  if (pErr) throw new Error(`proposals 取得失敗: ${pErr.message}`);
  const items = ((proposal?.items as ProposalEmailItem[] | null) ?? []).filter(
    Boolean,
  );
  if (items.length === 0) return { ok: false, skipped: true, reason: "提案なし" };

  // 実送信時はメール内リンクのため APP_BASE_URL 必須。未設定なら送らない。
  if (process.env.RESEND_API_KEY && !safeHttpUrl(process.env.APP_BASE_URL)) {
    return { ok: false, skipped: true, reason: "APP_BASE_URL未設定" };
  }

  const email = renderProposalDigestEmail({
    businessName: (biz.name as string | null) ?? null,
    summary: (proposal?.summary as string | null) ?? "",
    items,
    appBaseUrl: buildAppUrl("/dashboard"),
    now,
  });

  const sender = createEmailSender();
  const result = await sender.send({ to, ...email });

  const { error: nErr } = await admin.from("notifications").insert({
    business_id: businessId,
    match_id: null,
    type: "proposal_digest",
    channel: "email",
    status: result.ok ? "sent" : "failed",
    scheduled_for: now.toISOString(),
    sent_at: result.ok ? now.toISOString() : null,
    error: result.ok ? null : (result.error ?? null),
  });
  if (nErr) {
    // 記録失敗は致命ではない（送信自体は完了し得る）。ログのみ。
    console.error("[proposal-digest] notifications記録失敗:", nErr.message);
  }

  return { ok: result.ok, reason: result.ok ? undefined : result.error };
}
