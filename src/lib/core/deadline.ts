import { differenceInCalendarDays } from "date-fns";

/**
 * 締切接近通知のしきい値（公募締切の何日前に通知するか）。
 * 早く気づけることが本サービスの価値なので 30 日前を主軸に、14 / 7 日前のリマインドを行う。
 * （3 日前は申請に着手するには遅すぎるため設けない）
 */
export const DEADLINE_THRESHOLDS = [
  { type: "deadline_30d", days: 30 },
  { type: "deadline_14d", days: 14 },
  { type: "deadline_7d", days: 7 },
] as const;

export type DeadlineNotificationType =
  (typeof DEADLINE_THRESHOLDS)[number]["type"];

/**
 * 締切までの残り日数（暦日ベース）。締切当日は 0、過去は負の値。
 */
export function daysUntilDeadline(deadline: Date, now: Date): number {
  return differenceInCalendarDays(deadline, now);
}

/**
 * 現時点で「送るべき」締切通知の種別を返す純粋関数。
 *
 * - 残り日数がしきい値以下になった通知を対象にする（14日以下→14d、など）。
 * - 締切を過ぎている場合（残り<0）は何も返さない。
 * - 二重送信の防止は呼び出し側（notifications の unique 制約）が担う。
 *   この関数は「今この時点で該当するしきい値の集合」を返すだけ。
 */
export function dueDeadlineNotifications(
  deadline: Date,
  now: Date,
): DeadlineNotificationType[] {
  const remaining = daysUntilDeadline(deadline, now);
  if (remaining < 0) return [];
  return DEADLINE_THRESHOLDS.filter((t) => remaining <= t.days).map(
    (t) => t.type,
  );
}

/**
 * 残り日数に対して「最も緊急な未送信のしきい値」を1つだけ返す。
 * 日次バッチで1通ずつ送りたい場合に使う（3d > 7d > 14d の優先順）。
 */
export function mostUrgentDeadlineNotification(
  deadline: Date,
  now: Date,
): DeadlineNotificationType | null {
  const due = dueDeadlineNotifications(deadline, now);
  // しきい値の小さい順（緊急な順）に並べて先頭を返す。
  const sorted = [...due].sort((a, b) => thresholdDays(a) - thresholdDays(b));
  return sorted[0] ?? null;
}

function thresholdDays(type: DeadlineNotificationType): number {
  const found = DEADLINE_THRESHOLDS.find((t) => t.type === type);
  // DEADLINE_THRESHOLDS 由来の値のみ渡る前提だが、型安全のため明示。
  return found ? found.days : Number.MAX_SAFE_INTEGER;
}
