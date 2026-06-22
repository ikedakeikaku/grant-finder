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

/**
 * 制度名を比較用に正規化する。年度・回次・括弧書き・記号・空白を落とし、
 * 「【令和8年度】省CO2型システムへの改修支援事業」と「省CO2型システムへの改修支援事業」を
 * 同一視できるようにする純粋関数。
 */
export function normalizeProgramName(name: string): string {
  return name
    .replace(/【[^】]*】/g, "") // 【令和8年度】など角括弧ブロック
    .replace(/（[^）]*）/g, "") // 全角丸括弧ブロック
    .replace(/\([^)]*\)/g, "") // 半角丸括弧ブロック
    .replace(/第[0-9０-９]+回/g, "") // 第N回
    .replace(/令和[0-9０-９元]+年度?/g, "") // 令和N年度
    .replace(/[\s　・/／<>＜＞「」『』【】、,。.\-ー―－〜~]/g, "")
    .toLowerCase();
}

/** 名寄せ用の最短長。これ未満の正規化名は誤一致を避けるため比較対象にしない。 */
const MIN_NAME_LEN = 5;

/**
 * 2つの制度名が実質同一制度かを判定する。正規化後にどちらかが他方を包含すれば同一とみなす
 * （回次・年度・型番違いを吸収）。短すぎる名前は誤一致を避けて false。
 */
export function isSameProgram(a: string, b: string): boolean {
  const na = normalizeProgramName(a);
  const nb = normalizeProgramName(b);
  if (na.length < MIN_NAME_LEN || nb.length < MIN_NAME_LEN) return false;
  return na.includes(nb) || nb.includes(na);
}

/** name が others のいずれかと同一制度なら true（重複除去のための述語）。 */
export function overlapsAnyName(name: string, others: string[]): boolean {
  return others.some((o) => isSameProgram(name, o));
}
