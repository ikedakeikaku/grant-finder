import "./load-env";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";
import {
  planNotifications,
  preAnnounceDue,
  type NotificationType,
} from "../src/lib/core/notify-plan";
import {
  renderNotificationEmail,
  renderProposalDigestEmail,
  type ProposalEmailItem,
} from "../src/lib/notifications/render";
import {
  createEmailSender,
  type EmailSender,
} from "../src/lib/notifications/mailer";
import { buildAppUrl, safeHttpUrl } from "../src/lib/url";

/**
 * 通知バッチ。
 *   1. open マッチ: 作るべき通知(new_match / 締切30/14/7d)を planNotifications で決め enqueue。
 *   2. predicted/catalog マッチ: 公募前予告(pre_announce) を enqueue。
 *   3. 事業者: 提案書ダイジェスト(proposal_digest) を enqueue（初回＋月次）。
 *   4. scheduled かつ送信予定を過ぎた通知をレンダリングして送信、結果を記録。
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
    lead_status: string | null;
  } | null;
  subsidies: { acceptance_end_datetime: string | null } | null;
}

interface PredictedMatchRow {
  id: string;
  business_id: string;
  businesses: {
    notifications_enabled: boolean;
    notify_email: string | null;
    lead_status: string | null;
  } | null;
  subsidy_predictions: { predicted_start_from: string | null } | null;
  programs: { next_open_from: string | null } | null;
}

interface DueRow {
  id: string;
  type: NotificationType;
  status: "scheduled" | "processing";
  processing_started_at: string | null;
  business_id: string;
  businesses: {
    notify_email: string | null;
    name: string | null;
    lead_status: string | null;
  } | null;
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
    programs: {
      name: string;
      official_url: string | null;
      next_open_from: string | null;
    } | null;
  } | null;
}

interface ProposalRow {
  summary: string | null;
  items: ProposalEmailItem[] | null;
}

function toDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const PROCESSING_STALE_MINUTES = 30;
/** 提案書ダイジェストの再送間隔（日）。初回＋おおむね月次。 */
const DIGEST_INTERVAL_DAYS = 25;

async function enqueue(supabase: SupabaseAdmin, now: Date): Promise<number> {
  const { data, error } = await supabase
    .from("matches")
    .select(
      "id, business_id, businesses(notifications_enabled, notify_email, lead_status), subsidies(acceptance_end_datetime)",
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
    if (
      !biz?.notifications_enabled ||
      !biz.notify_email ||
      biz.lead_status !== "approved"
    )
      continue;
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

/** 予測(predicted)・カタログ(catalog) マッチについて公募前予告(pre_announce)を作成する。 */
async function enqueuePreAnnounce(
  supabase: SupabaseAdmin,
  now: Date,
): Promise<number> {
  const { data, error } = await supabase
    .from("matches")
    .select(
      "id, business_id, businesses(notifications_enabled, notify_email, lead_status), subsidy_predictions(predicted_start_from), programs(next_open_from)",
    )
    .in("kind", ["predicted", "catalog"])
    .eq("dismissed", false);
  if (error) throw new Error(`pre_announce対象 取得失敗: ${error.message}`);
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
    if (
      !biz?.notifications_enabled ||
      !biz.notify_email ||
      biz.lead_status !== "approved"
    )
      continue;
    if (sentSet.has(m.id)) continue;
    const start =
      toDate(m.subsidy_predictions?.predicted_start_from) ??
      toDate(m.programs?.next_open_from);
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

/** 提案書が ready の事業者に提案書ダイジェストを作成する（初回＋月次）。 */
async function enqueueProposalDigest(
  supabase: SupabaseAdmin,
  now: Date,
): Promise<number> {
  const { data, error } = await supabase
    .from("businesses")
    .select("id, notifications_enabled, notify_email, proposal_status")
    .eq("proposal_status", "ready")
    .eq("notifications_enabled", true)
    .eq("lead_status", "approved");
  if (error) throw new Error(`businesses 取得失敗: ${error.message}`);
  const businesses = (data ?? []) as Array<{
    id: string;
    notify_email: string | null;
  }>;
  if (businesses.length === 0) return 0;

  // 直近の proposal_digest 送信記録（business_id 単位）。
  const cutoff = new Date(
    now.getTime() - DIGEST_INTERVAL_DAYS * 86400_000,
  ).toISOString();
  const { data: recent, error: rErr } = await supabase
    .from("notifications")
    .select("business_id, created_at")
    .eq("type", "proposal_digest")
    .in("status", ["scheduled", "processing", "sent"])
    .gte("created_at", cutoff);
  if (rErr) throw new Error(`digest履歴 取得失敗: ${rErr.message}`);
  const recentSet = new Set(
    (recent ?? []).map((n: { business_id: string }) => n.business_id),
  );

  const toInsert: Array<Record<string, unknown>> = [];
  for (const b of businesses) {
    if (!b.notify_email) continue;
    if (recentSet.has(b.id)) continue;
    toInsert.push({
      business_id: b.id,
      match_id: null,
      type: "proposal_digest",
      channel: "email",
      status: "scheduled",
      scheduled_for: now.toISOString(),
    });
  }

  let inserted = 0;
  for (const row of toInsert) {
    const { error: insErr } = await supabase.from("notifications").insert(row);
    if (insErr) {
      if (insErr.code === "23505") continue; // 同時実行によるpending重複はDB制約に任せる。
      throw new Error(`proposal_digest 作成失敗: ${insErr.message}`);
    }
    inserted++;
  }
  return inserted;
}

async function fetchProposal(
  supabase: SupabaseAdmin,
  businessId: string,
): Promise<ProposalRow | null> {
  const { data, error } = await supabase
    .from("proposals")
    .select("summary, items")
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw new Error(`proposals 取得失敗: ${error.message}`);
  return (data as ProposalRow | null) ?? null;
}

async function sendDue(
  supabase: SupabaseAdmin,
  sender: EmailSender,
  now: Date,
): Promise<{ sent: number; failed: number; skipped: number }> {
  if (process.env.RESEND_API_KEY && !safeHttpUrl(process.env.APP_BASE_URL)) {
    throw new Error(
      "実メール送信時は APP_BASE_URL に https://... を設定してください",
    );
  }
  const appBaseUrl = buildAppUrl("/dashboard");
  const due = await fetchDueNotifications(supabase, now);

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const n of due) {
    const claimed = await claimNotification(supabase, n, now);
    if (!claimed) continue;

    const to = n.businesses?.notify_email ?? null;
    const approved = n.businesses?.lead_status === "approved";

    let email: { subject: string; text: string; html: string } | null = null;

    if (n.type === "proposal_digest") {
      const proposal = await fetchProposal(supabase, n.business_id);
      const items = (proposal?.items ?? []).filter(Boolean);
      if (approved && to && items.length > 0) {
        email = renderProposalDigestEmail({
          businessName: n.businesses?.name ?? null,
          summary: proposal?.summary ?? "",
          items,
          appBaseUrl,
          now,
        });
      }
    } else {
      const mk = n.matches;
      // open は subsidies、predicted/catalog は予測・programs から本文を作る。
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
      } else if (mk?.kind === "catalog") {
        const pg = mk.programs;
        if (pg) {
          title = pg.name;
          subsidyUrl = pg.official_url;
          const open = toDate(pg.next_open_from);
          if (open)
            reasons = [...reasons, `公募開始の見込み：${formatYm(open)}頃`];
        }
      } else {
        const sub = mk?.subsidies;
        if (sub) {
          title = sub.title;
          subsidyUrl = sub.front_subsidy_detail_page_url;
          acceptanceEnd = toDate(sub.acceptance_end_datetime);
        }
      }
      if (approved && to && title) {
        email = renderNotificationEmail({
          type: n.type,
          subsidyTitle: title,
          subsidyUrl,
          acceptanceEnd,
          reasons,
          appBaseUrl,
          now,
        });
      }
    }

    if (!email) {
      await supabase
        .from("notifications")
        .update({
          status: "skipped",
          processing_started_at: null,
          error: "宛先または対象情報なし",
        })
        .eq("id", n.id);
      skipped++;
      continue;
    }

    const result = await sender.send({ to: to as string, ...email });
    await supabase
      .from("notifications")
      .update({
        status: result.ok ? "sent" : "failed",
        processing_started_at: null,
        sent_at: result.ok ? now.toISOString() : null,
        error: result.ok ? null : (result.error ?? null),
      })
      .eq("id", n.id);
    if (result.ok) sent++;
    else failed++;
  }

  return { sent, failed, skipped };
}

const YM = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "long",
});
function formatYm(d: Date): string {
  return YM.format(d);
}

async function fetchDueNotifications(
  supabase: SupabaseAdmin,
  now: Date,
): Promise<DueRow[]> {
  const select =
    "id, type, status, processing_started_at, business_id, businesses(notify_email, name, lead_status), matches(kind, reasons, subsidies(title, front_subsidy_detail_page_url, acceptance_end_datetime), subsidy_predictions(name, basis, predicted_start_from), programs(name, official_url, next_open_from))";
  const nowIso = now.toISOString();
  const staleBefore = new Date(
    now.getTime() - PROCESSING_STALE_MINUTES * 60 * 1000,
  ).toISOString();

  const { data: scheduled, error: scheduledErr } = await supabase
    .from("notifications")
    .select(select)
    .eq("status", "scheduled")
    .eq("channel", "email")
    .lte("scheduled_for", nowIso);
  if (scheduledErr)
    throw new Error(`送信対象取得失敗: ${scheduledErr.message}`);

  const { data: stale, error: staleErr } = await supabase
    .from("notifications")
    .select(select)
    .eq("status", "processing")
    .eq("channel", "email")
    .lte("scheduled_for", nowIso)
    .lt("processing_started_at", staleBefore);
  if (staleErr)
    throw new Error(`送信中タイムアウト対象取得失敗: ${staleErr.message}`);

  return [...(scheduled ?? []), ...(stale ?? [])] as unknown as DueRow[];
}

async function claimNotification(
  supabase: SupabaseAdmin,
  notification: DueRow,
  now: Date,
): Promise<boolean> {
  const staleBefore = new Date(
    now.getTime() - PROCESSING_STALE_MINUTES * 60 * 1000,
  ).toISOString();

  let query = supabase
    .from("notifications")
    .update({
      status: "processing",
      processing_started_at: now.toISOString(),
      error: null,
    })
    .eq("id", notification.id)
    .select("id");

  if (notification.status === "scheduled") {
    query = query.eq("status", "scheduled");
  } else {
    query = query
      .eq("status", "processing")
      .lt("processing_started_at", staleBefore);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`通知claim失敗: ${error.message}`);
  return !!data;
}

async function main(): Promise<void> {
  const now = new Date();
  const supabase = createSupabaseAdminClient();
  const sender = createEmailSender();

  const enqueued = await enqueue(supabase, now);
  const preAnnounced = await enqueuePreAnnounce(supabase, now);
  const digests = await enqueueProposalDigest(supabase, now);
  console.log(
    `[notify] 新規作成: 通常${enqueued}件 / 公募前予告${preAnnounced}件 / 提案書${digests}件`,
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
