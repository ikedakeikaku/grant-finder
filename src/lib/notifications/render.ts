import { differenceInCalendarDays } from "date-fns";
import type { NotificationType } from "../core/notify-plan";

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
  }
}

export function renderNotificationEmail(
  input: NotificationRenderInput,
): RenderedEmail {
  const subject = subjectFor(input.type, input.subsidyTitle);

  const lines: string[] = [];
  lines.push(`「${input.subsidyTitle}」のお知らせです。`);
  lines.push("");

  if (input.acceptanceEnd) {
    const daysLeft = differenceInCalendarDays(input.acceptanceEnd, input.now);
    lines.push(`▼締切：${formatJst(input.acceptanceEnd)}`);
    if (daysLeft >= 0) lines.push(`（残り約${daysLeft}日）`);
  }
  if (input.reasons.length > 0) {
    lines.push("");
    lines.push("▼提案の理由");
    for (const r of input.reasons) lines.push(`・${r}`);
  }
  lines.push("");
  if (input.subsidyUrl) {
    lines.push(`▼募集の詳細（Jグランツ）\n${input.subsidyUrl}`);
  }
  lines.push(`▼登録した条件・他の提案を見る\n${input.appBaseUrl}`);
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
  input.subsidyUrl
    ? `<p><a href="${escapeHtml(input.subsidyUrl)}">募集の詳細（Jグランツ）</a></p>`
    : ""
}
<p><a href="${escapeHtml(input.appBaseUrl)}">登録した条件・他の提案を見る</a></p>
<p style="color:#888;font-size:12px">出典：Jグランツポータル（https://www.jgrants-portal.go.jp）</p>
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
