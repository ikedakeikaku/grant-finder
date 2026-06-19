/**
 * 公募前予測のコア（純粋関数）。
 * 制度ごとの過去の「公募開始日」から例年の開始月を学習し、次回の公募時期を予測する。
 * これが本サービスの差別化点（公募が始まる前に「例年そろそろ」と知らせる）。
 */

export interface OpeningPrediction {
  /** 例年の公募開始月 (1-12) */
  month: number;
  /** 予測する次回公募の開始ウィンドウ */
  from: Date;
  to: Date;
  /** 0..1。月の集中度 × サンプル数で算出 */
  confidence: number;
  /** 根拠の説明 */
  basis: string;
  /** 学習に使った過去公募回数 */
  sampleSize: number;
}

/**
 * 過去の公募開始日リストから次回公募時期を予測する。
 * - 2回未満の履歴では「例年」と言えないため null。
 * - 最頻の開始月を例年の時期とみなし、現在以降で次に来るその月を予測ウィンドウにする。
 */
export function predictNextOpening(
  starts: Date[],
  now: Date,
): OpeningPrediction | null {
  const valid = starts.filter((d) => !Number.isNaN(d.getTime()));
  if (valid.length < 2) return null;

  const counts = new Array<number>(13).fill(0);
  for (const d of valid) {
    const m = d.getUTCMonth() + 1;
    counts[m] = (counts[m] ?? 0) + 1;
  }

  let month = 1;
  let best = -1;
  for (let m = 1; m <= 12; m++) {
    const c = counts[m] ?? 0;
    if (c > best) {
      best = c;
      month = m;
    }
  }

  const nowMonth = now.getUTCMonth() + 1;
  const year =
    month >= nowMonth ? now.getUTCFullYear() : now.getUTCFullYear() + 1;
  const from = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const to = new Date(Date.UTC(year, month, 0, 23, 59, 59)); // 当月末日

  const concentration = best / valid.length;
  const confidence = Math.min(1, concentration * Math.min(valid.length / 3, 1));
  const basis = `例年${month}月頃に公募（過去${valid.length}回の実績）`;

  return { month, from, to, confidence, basis, sampleSize: valid.length };
}
