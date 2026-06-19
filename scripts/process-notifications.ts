import "./load-env";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";
import {
  planNotifications,
  preAnnounceDue,
  type NotificationType,
} from "../src/lib/core/notify-plan";
import { renderNotificationEmail } from "../src/lib/notifications/render";
import {
  createEmailSender,
  type EmailSender,
} from "../src/lib/notifications/mailer";

/**
 * 通知バッチ。
 *   1. 各マッチについて作るべき通知(new_match / 締切30/14/7d)を planNotifications で決め、
 *      notifications に挿入（match_id+type+channel の unique で二重作成を防止）。
 *   2. scheduled かつ送信予定時刻を過ぎた通知をレンダリングして送信、結果を記録。
 * 計画(plan)と本文(render)は純粋関数に委譲。ここはI/Oの殻。
 *
 * 注: Database 型を未生成のため、埋め込みリレーション(to-one)は実行時の単一オブジェクト
 *     形状に合わせてローカル型でキャストする（型生成後はこのキャストを外せる）。
 */

type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

interface MatchRow {
  id: string;
  business_id: string;
  businesses: {
    notifications_enabled: boolean;
    notify_email: string | null;
  } | null;
  subsidies: { acceptance_end_datetime: string | null } | null;
}

interface PredictedMatchRow {
  id: string;
  business_id: string;
  businesses: {
    notifications_enabled: boolean;
    notify_email: string | null;
  } | null;
  subsidy_predictions: { predicted_start_from: string | null } | null;
}

interface DueRow {
  id: string;
  type: NotificationType;
  businesses: { notify_email: string | null } | null;
  matches: {
    kind: string;
    reasons: string[] | null;
    subsidies: {
      title: string;
      front_subsidy_detail_page_url: string | null;
      acceptance_end_datetime: string | null;
    } | null;
    subsidy_predictions: {
      name: string;
      basis: string | null;
      predicted_start_from: string | null;
    } | null;
  } | null;
}

function toDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function enqueue(supabase: SupabaseAdmin, now: Date): Promise<number> {
  const { data, error } = await supabase
    .from("matches")
    .select(
      "id, business_id, businesses(notifications_enabled, notify_email), subsidies(acceptance_end_datetime)",
    )
    .eq("kind", "open")
    .eq("dismissed", false);
  if (error) throw new Error(`matches 取得失敗: ${error.message}`);
  const matches = (data ?? []) as unknown as MatchRow[];

  const { data: existing, error: nErr } = await supabase
    .from("notifications")
    .select("match_id, type");
  if (nErr) throw new Error(`notifications 取得失敗: ${nErr.message}`);

  const existingByMatch = new Map<string, string[]>();
  for (const n of (existing ?? []) as {
    match_id: string | null;
    type: string;
  }[]) {
    if (!n.match_id) continue;
    const list = existingByMatch.get(n.match_id) ?? [];
    list.push(n.type);
    existingByMatch.set(n.match_id, list);
  }

  const toInsert: Array<Record<string, unknown>> = [];
  for (const m of matches) {
    const biz = m.businesses;
    if (!biz?.notifications_enabled || !biz.notify_email) continue;
    const acceptanceEnd = toDate(m.subsidies?.acceptance_end_datetime);
    const planned = planNotifications(
      { existingTypes: existingByMatch.get(m.id) ?? [], acceptanceEnd },
      now,
    );
    for (const type of planned) {
      toInsert.push({
        business_id: m.business_id,
        match_id: m.id,
        type,
        channel: "email",
        status: "scheduled",
        scheduled_for: now.toISOString(),
      });
    }
  }

  if (toInsert.length > 0) {
    const { error: insErr } = await supabase
      .from("notifications")
      .upsert(toInsert, {
        onConflict: "match_id,type,channel",
        ignoreDuplicates: true,
      });
    if (insErr) throw new Error(`notifications 作成失敗: ${insErr.message}`);
  }
  return toInsert.length;
}

/** 予測マッチについて公募前予告(pre_announce)を作成する。 */
async function enqueuePreAnnounce(
  supabase: SupabaseAdmin,
  now: Date,
): Promise<number> {
  const { data, error } = await supabase
    .from("matches")
    .select(
      "id, business_id, businesses(notifications_enabled, notify_email), subsidy_predictions(predicted_start_from)",
    )
    .eq("kind", "predicted")
    .eq("dismissed", false);
  if (error) throw new Error(`predicted matches 取得失敗: ${error.message}`);
  const matches = (data ?? []) as unknown as PredictedMatchRow[];

  const { data: existing, error: nErr } = await supabase
    .from("notifications")
    .select("match_id")
    .eq("type", "pre_announce");
  if (nErr) throw new Error(`notifications 取得失敗: ${nErr.message}`);
  const sentSet = new Set(
    (existing ?? [])
      .map((n: { match_id: string | null }) => n.match_id)
      .filter(Boolean),
  );

  const toInsert: Array<Record<string, unknown>> = [];
  for (const m of matches) {
    const biz = m.businesses;
    if (!biz?.notifications_enabled || !biz.notify_email) continue;
    if (sentSet.has(m.id)) continue;
    const start = toDate(m.subsidy_predictions?.predicted_start_from);
    if (!start || !preAnnounceDue(start, now)) continue;
    toInsert.push({
      business_id: m.business_id,
      match_id: m.id,
      type: "pre_announce",
      channel: "email",
      status: "scheduled",
      scheduled_for: now.toISOString(),
    });
  }

  if (toInsert.length > 0) {
    const { error: insErr } = await supabase
      .from("notifications")
      .upsert(toInsert, {
        onConflict: "match_id,type,channel",
        ignoreDuplicates: true,
      });
    if (insErr) throw new Error(`pre_announce 作成失敗: ${insErr.message}`);
  }
  return toInsert.length;
}

async function sendDue(
  supabase: SupabaseAdmin,
  sender: EmailSender,
  now: Date,
): Promise<{ sent: number; failed: number; skipped: number }> {
  const appBaseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
  const { data, error } = await supabase
    .from("notifications")
    .select(
      "id, type, businesses(notify_email), matches(kind, reasons, subsidies(title, front_subsidy_detail_page_url, acceptance_end_datetime), subsidy_predictions(name, basis, predicted_start_from))",
    )
    .eq("status", "scheduled")
    .eq("channel", "email")
    .lte("scheduled_for", now.toISOString());
  if (error) throw new Error(`送信対象取得失敗: ${error.message}`);
  const due = (data ?? []) as unknown as DueRow[];

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const n of due) {
    const to = n.businesses?.notify_email ?? null;
    const mk = n.matches;

    // open は subsidies、predicted は subsidy_predictions から本文を作る。
    let title: string | null = null;
    let subsidyUrl: string | null = null;
    let acceptanceEnd: Date | null = null;
    let reasons: string[] = mk?.reasons ?? [];
    if (mk?.kind === "predicted") {
      const pr = mk.subsidy_predictions;
      if (pr) {
        title = pr.name;
        reasons = [...reasons, pr.basis].filter((x): x is string => !!x);
      }
    } else {
      const sub = mk?.subsidies;
      if (sub) {
        title = sub.title;
        subsidyUrl = sub.front_subsidy_detail_page_url;
        acceptanceEnd = toDate(sub.acceptance_end_datetime);
      }
    }

    if (!to || !title) {
      await supabase
        .from("notifications")
        .update({ status: "skipped", error: "宛先または対象情報なし" })
        .eq("id", n.id);
      skipped++;
      continue;
    }

    const email = renderNotificationEmail({
      type: n.type,
      subsidyTitle: title,
      subsidyUrl,
      acceptanceEnd,
      reasons,
      appBaseUrl,
      now,
    });

    const result = await sender.send({ to, ...email });
    await supabase
      .from("notifications")
      .update({
        status: result.ok ? "sent" : "failed",
        sent_at: result.ok ? now.toISOString() : null,
        error: result.ok ? null : (result.error ?? null),
      })
      .eq("id", n.id);
    if (result.ok) sent++;
    else failed++;
  }

  return { sent, failed, skipped };
}

async function main(): Promise<void> {
  const now = new Date();
  const supabase = createSupabaseAdminClient();
  const sender = createEmailSender();

  const enqueued = await enqueue(supabase, now);
  const preAnnounced = await enqueuePreAnnounce(supabase, now);
  console.log(
    `[notify] 新規作成: 通常${enqueued}件 / 公募前予告${preAnnounced}件`,
  );

  const r = await sendDue(supabase, sender, now);
  console.log(
    `[notify] 送信 sent=${r.sent} failed=${r.failed} skipped=${r.skipped}`,
  );
}

main().catch((err) => {
  console.error("[error]", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
