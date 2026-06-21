import type { NotificationType } from "../core/notify-plan";
import { safeHttpUrl } from "../url";
import { formatSubsidyMax } from "../catalog/programs";

/**
 * JST（日本時間）の暦日で「締切まで残り何日」を計算する。
 * date-fns の differenceInCalendarDays は実行環境のローカルTZ依存のため、
 * UTCで動くサーバー（GitHub Actions/Vercel）だと JST 表示の締切と1日ズレる。
 * 締切表示は JST なので、残日数も JST 基準に統一する。
 */
const DAY_MS = 86_400_000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
function jstCalendarDaysBetween(end: Date, now: Date): number {
  const jstDay = (d: Date) =>
    Math.floor((d.getTime() + JST_OFFSET_MS) / DAY_MS);
  return jstDay(end) - jstDay(now);
}

/**
 * 通知メールの本文生成（純粋関数）。送信手段(mailer)とは分離してテスト可能にする。
 * 受託への誘導ボタンは載せない（運営が個別に接触する方針）。
 */

export interface NotificationRenderInput {
  type: NotificationType;
  subsidyTitle: string;
  /** jGrants 詳細ページURL（出典明示にも使う） */
  subsidyUrl: string | null;
  acceptanceEnd: Date | null;
  /** 提案理由（マッチング由来） */
  reasons: string[];
  /** アプリのダッシュボードURL */
  appBaseUrl: string;
  now: Date;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const JST = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatJst(d: Date): string {
  return JST.format(d);
}

function subjectFor(type: NotificationType, title: string): string {
  switch (type) {
    case "new_match":
      return `【新着】あなたに合いそうな補助金：${title}`;
    case "opened":
      return `【公募開始】${title}`;
    case "pre_announce":
      return `【まもなく公募】例年そろそろ：${title}`;
    case "deadline_30d":
      return `【締切30日前】${title}`;
    case "deadline_14d":
      return `【締切まで2週間】${title}`;
    case "deadline_7d":
      return `【締切まで1週間】${title}`;
    case "proposal_digest":
      return `【補助金のご提案】${title}`;
  }
}

export function renderNotificationEmail(
  input: NotificationRenderInput,
): RenderedEmail {
  const subject = subjectFor(input.type, input.subsidyTitle);
  const subsidyUrl = safeHttpUrl(input.subsidyUrl);
  const appBaseUrl = safeHttpUrl(input.appBaseUrl);

  const lines: string[] = [];
  lines.push(`「${input.subsidyTitle}」のお知らせです。`);
  lines.push("");

  if (input.acceptanceEnd) {
    const daysLeft = jstCalendarDaysBetween(input.acceptanceEnd, input.now);
    lines.push(`▼締切：${formatJst(input.acceptanceEnd)}`);
    if (daysLeft >= 0) lines.push(`（残り約${daysLeft}日）`);
  }
  if (input.reasons.length > 0) {
    lines.push("");
    lines.push("▼提案の理由");
    for (const r of input.reasons) lines.push(`・${r}`);
  }
  lines.push("");
  if (subsidyUrl) {
    lines.push(`▼募集の詳細（Jグランツ）\n${subsidyUrl}`);
  }
  if (appBaseUrl) {
    lines.push(`▼登録した条件・他の提案を見る\n${appBaseUrl}`);
  }
  lines.push("");
  lines.push("出典：Jグランツポータル（https://www.jgrants-portal.go.jp）");

  const text = lines.join("\n");

  const html = `<div style="font-family:sans-serif;line-height:1.7">
<p>「${escapeHtml(input.subsidyTitle)}」のお知らせです。</p>
${
  input.acceptanceEnd
    ? `<p><strong>締切：</strong>${escapeHtml(formatJst(input.acceptanceEnd))}</p>`
    : ""
}
${
  input.reasons.length > 0
    ? `<p><strong>提案の理由</strong></p><ul>${input.reasons
        .map((r) => `<li>${escapeHtml(r)}</li>`)
        .join("")}</ul>`
    : ""
}
${
  subsidyUrl
    ? `<p><a href="${escapeHtml(subsidyUrl)}">募集の詳細（Jグランツ）</a></p>`
    : ""
}
${appBaseUrl ? `<p><a href="${escapeHtml(appBaseUrl)}">登録した条件・他の提案を見る</a></p>` : ""}
<p style="color:#888;font-size:12px">出典：Jグランツポータル（https://www.jgrants-portal.go.jp）</p>
</div>`;

  return { subject, text, html };
}

// ----------------------------------------------------------------------------
// 提案書ダイジェスト（初回/月次・複数カード）
// ----------------------------------------------------------------------------

export interface ProposalEmailItem {
  name: string;
  fitReason: string;
  usability: string;
  prepare: string[];
  scheduleNote: string;
  subsidyMax: number | null;
  subsidyRate: string | null;
  officialUrl: string | null;
  isLargeAmount: boolean;
  isStartup: boolean;
}

export interface ProposalDigestInput {
  businessName?: string | null;
  summary: string;
  items: ProposalEmailItem[];
  appBaseUrl: string;
  now: Date;
}

function tags(it: ProposalEmailItem): string {
  const t: string[] = [];
  if (it.isLargeAmount) t.push("大型");
  if (it.isStartup) t.push("創業");
  return t.length ? `［${t.join("・")}］` : "";
}

/**
 * 事業者向けの提案書ダイジェストメール（純粋関数）。
 * 「使える根拠」つきで複数の補助金を案内する。発表用のため受託CTAは汎用文言のみ（実リンクなし）。
 */
export function renderProposalDigestEmail(
  input: ProposalDigestInput,
): RenderedEmail {
  const subject = subjectFor(
    "proposal_digest",
    `${input.items.length}件の有望な補助金`,
  );
  const appBaseUrl = safeHttpUrl(input.appBaseUrl);

  const lines: string[] = [];
  lines.push(
    `${input.businessName ? input.businessName + " 様" : "ご担当者"}、今年活用が見込める補助金をまとめました。`,
  );
  if (input.summary) {
    lines.push("");
    lines.push(input.summary);
  }
  lines.push("");
  input.items.forEach((it, i) => {
    const officialUrl = safeHttpUrl(it.officialUrl);
    lines.push(`━━ ${i + 1}. ${it.name} ${tags(it)}`.trim());
    const money = [formatSubsidyMax(it.subsidyMax)];
    if (it.subsidyRate) money.push(`補助率 ${it.subsidyRate}`);
    lines.push(`　${money.join(" / ")}`);
    if (it.scheduleNote) lines.push(`　▷ 時期：${it.scheduleNote}`);
    if (it.fitReason) lines.push(`　▷ 合う理由：${it.fitReason}`);
    if (it.usability) lines.push(`　▷ 使えるか：${it.usability}`);
    if (it.prepare.length > 0)
      lines.push(`　▷ ご準備：${it.prepare.join("、")}`);
    if (officialUrl) lines.push(`　▷ 公式：${officialUrl}`);
    lines.push("");
  });
  lines.push("──────────");
  lines.push("公募が近づいた制度は、その都度メールでお知らせします。");
  lines.push("申請に関するご相談も承っています（初回無料）。");
  if (appBaseUrl) {
    lines.push("");
    lines.push(`▼登録した条件・最新の提案を見る\n${appBaseUrl}`);
  }
  lines.push("");
  lines.push(
    "出典：各制度の公式情報・Jグランツポータル（https://www.jgrants-portal.go.jp）",
  );
  const text = lines.join("\n");

  const cards = input.items
    .map((it, i) => {
      const money = [formatSubsidyMax(it.subsidyMax)];
      if (it.subsidyRate) money.push(`補助率 ${escapeHtml(it.subsidyRate)}`);
      const rows: string[] = [];
      if (it.scheduleNote)
        rows.push(
          `<li><strong>時期：</strong>${escapeHtml(it.scheduleNote)}</li>`,
        );
      if (it.fitReason)
        rows.push(
          `<li><strong>合う理由：</strong>${escapeHtml(it.fitReason)}</li>`,
        );
      if (it.usability)
        rows.push(
          `<li><strong>使えるか：</strong>${escapeHtml(it.usability)}</li>`,
        );
      if (it.prepare.length > 0)
        rows.push(
          `<li><strong>ご準備：</strong>${escapeHtml(it.prepare.join("、"))}</li>`,
        );
      const link = safeHttpUrl(it.officialUrl);
      if (link)
        rows.push(`<li><a href="${escapeHtml(link)}">公式サイト</a></li>`);
      return `<div style="border:1px solid #e5e5e5;border-radius:8px;padding:12px 16px;margin:12px 0">
<p style="margin:0 0 4px;font-weight:bold">${i + 1}. ${escapeHtml(it.name)} <span style="color:#c2410c;font-size:12px">${escapeHtml(tags(it))}</span></p>
<p style="margin:0 0 6px;color:#555">${escapeHtml(money.join(" / "))}</p>
<ul style="margin:0;padding-left:18px">${rows.join("")}</ul>
</div>`;
    })
    .join("");

  const html = `<div style="font-family:sans-serif;line-height:1.7;max-width:640px">
<p>${escapeHtml(input.businessName ? input.businessName + " 様" : "ご担当者")}、今年活用が見込める補助金をまとめました。</p>
${input.summary ? `<p>${escapeHtml(input.summary)}</p>` : ""}
${cards}
<p style="margin-top:16px">公募が近づいた制度は、その都度メールでお知らせします。<br>申請に関するご相談も承っています（初回無料）。</p>
${appBaseUrl ? `<p><a href="${escapeHtml(appBaseUrl)}">登録した条件・最新の提案を見る</a></p>` : ""}
<p style="color:#888;font-size:12px">出典：各制度の公式情報・Jグランツポータル（https://www.jgrants-portal.go.jp）</p>
</div>`;

  return { subject, text, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
