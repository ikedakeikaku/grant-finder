/**
 * 同一制度の複数回次（例: ものづくり補助金 19/20/21/22次）を1件に名寄せする。
 * 同じ schedule_key のものは「締切が最も近い回次（=次に対応すべき回）」だけを残す。
 */

export interface DedupeItem {
  id: string;
  scheduleKey: string | null;
  acceptanceEnd: string | null; // ISO 文字列
}

function endTime(item: DedupeItem): number {
  if (!item.acceptanceEnd) return Number.POSITIVE_INFINITY;
  const t = new Date(item.acceptanceEnd).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/**
 * schedule_key ごとに締切が最も近い1件へ集約する純粋関数。
 * schedule_key が空のものは制度名寄せ対象外として全件残す。
 */
export function dedupeByScheduleKey<T extends DedupeItem>(items: T[]): T[] {
  const groups = new Map<string, T[]>();
  const singles: T[] = [];

  for (const item of items) {
    const key =
      item.scheduleKey && item.scheduleKey.length > 0 ? item.scheduleKey : null;
    if (!key) {
      singles.push(item);
      continue;
    }
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  const representatives: T[] = [];
  for (const group of groups.values()) {
    representatives.push(
      group.reduce((best, cur) => (endTime(cur) < endTime(best) ? cur : best)),
    );
  }

  return [...representatives, ...singles];
}
