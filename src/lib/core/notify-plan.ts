import { differenceInCalendarDays } from "date-fns";
import {
  dueDeadlineNotifications,
  type DeadlineNotificationType,
} from "./deadline";

/** 公募前予告(pre_announce)を出すリードタイム（予測公募開始の何日前に1回目を飛ばすか） */
export const PRE_ANNOUNCE_LEAD_DAYS = 60;

/**
 * 公募前予告を出すべきタイミングか。
 * 予測される公募開始まで PRE_ANNOUNCE_LEAD_DAYS 日以内（かつ開始前）なら true。
 */
export function preAnnounceDue(predictedStartFrom: Date, now: Date): boolean {
  const days = differenceInCalendarDays(predictedStartFrom, now);
  return days >= 0 && days <= PRE_ANNOUNCE_LEAD_DAYS;
}

/**
 * 1マッチについて「今この時点で新たに作るべき通知種別」を決める純粋関数群。
 * 二重送信の最終防御は DB の unique 制約だが、ここでも既存種別を見て差分のみ返す。
 */

export type NotificationType =
  | "new_match"
  | "opened"
  | "pre_announce"
  | "proposal_digest"
  | DeadlineNotificationType;

export interface MatchNotifyState {
  /** すでに作成済みの通知種別（このマッチ・このチャネル分） */
  existingTypes: string[];
  /** 補助金の受付締切（無ければ締切通知は出さない） */
  acceptanceEnd: Date | null;
}

/**
 * このマッチに対して新規作成すべき通知種別を返す。
 * - new_match: まだ一度も通知していなければ最初に1回。
 * - 締切通知(30/14/7d): 締切までの残日数で「該当しているが未作成」のものだけ。
 */
export function planNotifications(
  state: MatchNotifyState,
  now: Date,
): NotificationType[] {
  const planned: NotificationType[] = [];
  const has = (t: string) => state.existingTypes.includes(t);

  if (!has("new_match")) planned.push("new_match");

  if (state.acceptanceEnd) {
    for (const t of dueDeadlineNotifications(state.acceptanceEnd, now)) {
      if (!has(t)) planned.push(t);
    }
  }

  return planned;
}

/**
 * 送信頻度の最短間隔（日）。緊急以外はこの間隔まで束ねて「毎日メール」を防ぐ。
 */
export const MIN_SEND_INTERVAL_DAYS = 3;

/** 間隔を待たず即送る緊急通知（締切直前・公募開始）。 */
export const URGENT_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  "deadline_7d",
  "opened",
]);

/**
 * いま送ってよいか（最短送信間隔の判定・純粋関数）。
 * - 緊急通知を含む場合は常に送る。
 * - 直近送信が無ければ送る。
 * - 直近送信から minIntervalDays 日以上経っていれば送る。それ未満なら束ねるため見送り。
 */
export function shouldSendNow(
  lastSentAt: Date | null,
  now: Date,
  hasUrgent: boolean,
  minIntervalDays: number = MIN_SEND_INTERVAL_DAYS,
): boolean {
  if (hasUrgent) return true;
  if (!lastSentAt) return true;
  const days = (now.getTime() - lastSentAt.getTime()) / 86_400_000;
  return days >= minIntervalDays;
}
