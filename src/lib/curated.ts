/**
 * 主要制度のキュレーション（公式日程）。
 *
 * jGrants公開APIは、ものづくり等の複数回次プログラムで acceptance_end に
 * 「制度全体の広い期間」を返し、実際の各回の申請締切と一致しない。
 * そこで主要制度だけは公式サイトの正確な日程で上書きする。
 *   - jGrants の該当エントリは抑制（isCuratedJgrantsTitle）
 *   - 現在応募できる回があればライブ提案、なければ予測に回す
 *
 * 日付は JST。publicationStart=公募開始日、applicationEnd=申請締切日。
 */

export interface CuratedRound {
  label: string;
  publicationStart: string; // 公募開始(ISO)
  applicationEnd: string; // 申請締切(ISO)
}

export interface CuratedProgram {
  /** 安定した識別子（subsidies.id を `curated:<slug>` で作る） */
  slug: string;
  scheduleKey: string;
  name: string;
  detailUrl: string;
  /** jGrants側の同制度エントリを抑制するためのタイトル部分一致 */
  titleMatch: string[];
  /** マッチング用メタ（jGrants相当） */
  areaSearch: string;
  usePurpose: string;
  targetNumberOfEmployees: string;
  subsidyMaxLimit: number | null;
  subsidyRate: string | null;
  rounds: CuratedRound[];
}

export const CURATED_PROGRAMS: CuratedProgram[] = [
  {
    slug: "monozukuri-meti",
    scheduleKey: "【経済産業省】ものづくり・商業・サービス生産性向上促進補助金",
    name: "ものづくり・商業・サービス生産性向上促進補助金",
    detailUrl: "https://portal.monodukuri-hojo.jp/",
    titleMatch: ["ものづくり・商業・サービス生産性向上"],
    areaSearch: "全国",
    usePurpose: "新たな事業を行いたい / 設備整備・IT導入をしたい",
    targetNumberOfEmployees: "中小企業者",
    subsidyMaxLimit: 40000000,
    subsidyRate: "1/2 もしくは 2/3",
    rounds: [
      {
        label: "22次締切",
        publicationStart: "2025-10-24T00:00:00+09:00",
        applicationEnd: "2026-01-30T17:00:00+09:00",
      },
      {
        label: "23次締切",
        publicationStart: "2026-02-06T00:00:00+09:00",
        applicationEnd: "2026-05-08T17:00:00+09:00",
      },
    ],
  },
];

/** jGrants のタイトルがキュレーション対象制度かどうか（抑制判定）。 */
export function isCuratedJgrantsTitle(title: string): boolean {
  return CURATED_PROGRAMS.some((p) =>
    p.titleMatch.some((t) => title.includes(t)),
  );
}

/** 現在応募できる回（公募開始〜申請締切の範囲内）を返す。無ければ null。 */
export function findOpenRound(
  program: CuratedProgram,
  now: Date,
): CuratedRound | null {
  const t = now.getTime();
  for (const r of program.rounds) {
    const s = new Date(r.publicationStart).getTime();
    const e = new Date(r.applicationEnd).getTime();
    if (!Number.isNaN(s) && !Number.isNaN(e) && t >= s && t <= e) return r;
  }
  return null;
}
