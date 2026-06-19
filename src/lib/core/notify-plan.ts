import {
  dueDeadlineNotifications,
  type DeadlineNotificationType,
} from "./deadline";

/**
 * 1マッチについて「今この時点で新たに作るべき通知種別」を決める純粋関数群。
 * 二重送信の最終防御は DB の unique 制約だが、ここでも既存種別を見て差分のみ返す。
 */

export type NotificationType =
  | "new_match"
  | "opened"
  | "pre_announce"
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
