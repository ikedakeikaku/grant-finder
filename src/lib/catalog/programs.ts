/**
 * 制度マスタ（カタログ）。
 *
 * 提案の「母集団」。jGrantsキーワード取込に依存せず、中小企業支援で実際に効く
 * 主要制度（国＋自治体）を構造化して保有する。各制度に補助率・上限・主要要件・
 * 例年スケジュール・予算動向・公式URL・出典を持たせ、提案エンジン(proposer)が
 * 「この事業者が実際に使えるか」を判断できるようにする。
 *
 * 事実の更新は `scripts/research-catalog.ts`（Web調査）が `programs` テーブルへ反映する。
 * このファイルは型・pureヘルパー・初期シードの正本。
 * 初期シードは research-output.json（並列Web調査＋敵対的検証の成果）を正規化して構成する。
 */

import rawPrograms from "./research-output.json";

export type ProgramLevel = "national" | "prefecture" | "municipal";
export type ProgramStatus = "active" | "watch" | "ended";

export interface CatalogProgram {
  /** 安定識別子（英小文字/ハイフン）。DBの id は `prog:<slug>`。 */
  slug: string;
  name: string;
  level: ProgramLevel;
  /** 自治体制度の都道府県。国制度は null。 */
  prefecture: string | null;
  /** 対象地域。全国 / 東京都 等。 */
  areaSearch: string;
  /** 何に使えるか（目的）。 */
  purpose: string;
  /** 対象業種。全業種なら ["全業種"]。 */
  targetIndustries: string[];
  /** 対象規模。中小企業者 / 小規模事業者 / 従業員20人以下 等。 */
  targetSize: string;
  /** 補助率。1/2, 2/3 等。 */
  subsidyRate: string | null;
  /** 補助上限額（円）。枠で異なる場合は最大値。 */
  subsidyMax: number | null;
  /** 主要要件。賃上げ/GビズID/認定経営革新等支援機関/賃金台帳/事業計画 等。 */
  keyRequirements: string[];
  /** 申請枠。通常枠/省力化枠 等。 */
  applicationFrames: string[];
  /** 例年の公募開始・締切の傾向。 */
  typicalSchedule: string | null;
  /** 予算動向（概算要求/補正/当初/実施有無）。差別化の核。 */
  budgetBasis: string | null;
  officialUrl: string | null;
  /** jGrants/予測との名寄せキー（回次・年度を除く制度名）。 */
  scheduleKey: string | null;
  status: ProgramStatus;
  /** 次回公募の見込み（確定 or 予測）。ISO 文字列。 */
  nextOpenFrom: string | null;
  nextOpenTo: string | null;
  /** 情報の確度 0..1。 */
  confidence: number;
  /** 補助額が大きい制度か（目安: 上限1000万円超）。 */
  isLargeAmount: boolean;
  /** 創業・起業関連か。 */
  isStartup: boolean;
  /** 統合・後継の注記（例: ものづくりと新事業進出は統合予定）。 */
  unifiedWith: string | null;
  sources: string[];
  notes: string | null;
  /** 由来。manual / research / curated。 */
  source: string;
}

/** DB の id（`prog:<slug>`）を作る。 */
export function programId(slug: string): string {
  return `prog:${slug}`;
}

/** DB(programs) への upsert 用に snake_case 行へ変換する（純粋関数）。 */
export function toProgramRow(p: CatalogProgram): Record<string, unknown> {
  return {
    id: programId(p.slug),
    name: p.name,
    level: p.level,
    prefecture: p.prefecture,
    area_search: p.areaSearch,
    purpose: p.purpose,
    target_industries: p.targetIndustries,
    target_size: p.targetSize,
    subsidy_rate: p.subsidyRate,
    subsidy_max: p.subsidyMax,
    key_requirements: p.keyRequirements,
    application_frames: p.applicationFrames,
    typical_schedule: p.typicalSchedule,
    budget_basis: p.budgetBasis,
    official_url: p.officialUrl,
    schedule_key: p.scheduleKey,
    status: p.status,
    next_open_from: p.nextOpenFrom,
    next_open_to: p.nextOpenTo,
    confidence: p.confidence,
    is_large_amount: p.isLargeAmount,
    is_startup: p.isStartup,
    unified_with: p.unifiedWith,
    sources: p.sources,
    notes: p.notes,
    source: p.source,
  };
}

/**
 * 事業者の所在地がこの制度の対象地域に含まれるか（純粋関数）。
 * 全国・地域不明は対象とみなす（安全側）。core/matching.isAreaEligible と同方針。
 */
export function isProgramInArea(
  program: Pick<CatalogProgram, "areaSearch" | "level" | "prefecture">,
  prefecture: string | null,
  city: string | null = null,
): boolean {
  if (program.level === "national") return true;
  const area = program.areaSearch ?? "";
  if (!area || area.includes("全国")) return true;
  if (program.prefecture && prefecture && program.prefecture === prefecture)
    return true;
  if (prefecture && area.includes(prefecture)) return true;
  if (city && area.includes(city)) return true;
  if (!prefecture && !city) return true; // 判定不能 → 除外しない
  return false;
}

/** 補助上限額を読みやすい日本語に整形する（提案書/メール表示用・純粋関数）。 */
export function formatSubsidyMax(yen: number | null): string {
  if (yen == null || !Number.isFinite(yen) || yen <= 0) return "金額は要確認";
  if (yen >= 100_000_000) {
    const oku = yen / 100_000_000;
    return `最大${Number.isInteger(oku) ? oku : oku.toFixed(1)}億円`;
  }
  const man = Math.round(yen / 10_000);
  return `最大${man.toLocaleString("ja-JP")}万円`;
}

// ----------------------------------------------------------------------------
// research-output.json の正規化
//   Web調査エージェントの出力（文字列の金額/年月、HTMLエスケープ等）を CatalogProgram へ。
// ----------------------------------------------------------------------------

/** research-output.json の1レコード（調査エージェントのスキーマ）。 */
export interface RawProgram {
  slug: string;
  name: string;
  level: string;
  prefecture: string;
  areaSearch: string;
  purpose: string;
  targetIndustries: string[];
  targetSize: string;
  subsidyRate: string;
  subsidyMax: string;
  keyRequirements: string[];
  applicationFrames: string[];
  typicalSchedule: string;
  budgetBasis: string;
  officialUrl: string;
  scheduleKey: string;
  status: string;
  nextOpen: string;
  confidence: number;
  isLargeAmount: boolean;
  isStartup: boolean;
  unifiedWith: string;
  sources: string[];
  notes: string;
}

const LEVELS: ProgramLevel[] = ["national", "prefecture", "municipal"];
const STATUSES: ProgramStatus[] = ["active", "watch", "ended"];

/** HTMLエンティティを素のテキストに戻す（調査出力に &amp; 等が混入するため）。 */
export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** 金額文字列（"100000000" や "1500000000（…15億円…）"）から先頭の円額を取り出す。 */
export function parseYen(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.replace(/[,，]/g, "").match(/\d{4,}/);
  return m ? Number(m[0]) : null;
}

/** "2026-07" / "2026-07-01" を月初の ISO 文字列に。解釈不能は null。 */
export function parseMonthIso(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.match(/(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = m[3] ? Number(m[3]) : 1;
  if (mo < 1 || mo > 12) return null;
  return new Date(Date.UTC(y, mo - 1, d)).toISOString();
}

function blankToNull(s: string): string | null {
  const t = s?.trim?.() ?? "";
  return t.length > 0 ? t : null;
}

/** 調査出力レコードを CatalogProgram に正規化する（純粋関数）。 */
export function fromResearchRecord(raw: RawProgram): CatalogProgram {
  const level = (LEVELS as string[]).includes(raw.level)
    ? (raw.level as ProgramLevel)
    : "national";
  const status = (STATUSES as string[]).includes(raw.status)
    ? (raw.status as ProgramStatus)
    : "watch";
  return {
    slug: raw.slug,
    name: decodeEntities(raw.name),
    level,
    prefecture: blankToNull(decodeEntities(raw.prefecture ?? "")),
    areaSearch: raw.areaSearch || (level === "national" ? "全国" : ""),
    purpose: decodeEntities(raw.purpose ?? ""),
    targetIndustries: (raw.targetIndustries ?? []).map(decodeEntities),
    targetSize: decodeEntities(raw.targetSize ?? ""),
    subsidyRate: blankToNull(decodeEntities(raw.subsidyRate ?? "")),
    subsidyMax: parseYen(raw.subsidyMax),
    keyRequirements: (raw.keyRequirements ?? []).map(decodeEntities),
    applicationFrames: (raw.applicationFrames ?? []).map(decodeEntities),
    typicalSchedule: blankToNull(decodeEntities(raw.typicalSchedule ?? "")),
    budgetBasis: blankToNull(decodeEntities(raw.budgetBasis ?? "")),
    officialUrl: blankToNull(raw.officialUrl ?? ""),
    scheduleKey: blankToNull(decodeEntities(raw.scheduleKey ?? "")),
    status,
    nextOpenFrom: parseMonthIso(raw.nextOpen),
    nextOpenTo: null,
    confidence:
      typeof raw.confidence === "number"
        ? Math.max(0, Math.min(1, raw.confidence))
        : 0,
    isLargeAmount: !!raw.isLargeAmount,
    isStartup: !!raw.isStartup,
    unifiedWith: blankToNull(decodeEntities(raw.unifiedWith ?? "")),
    sources: raw.sources ?? [],
    notes: blankToNull(decodeEntities(raw.notes ?? "")),
    source: "research",
  };
}

// ----------------------------------------------------------------------------
// 初期シード
//   research-output.json（国＋東京/大阪/神奈川/山梨の主要・省エネ・創業・大型補助金、
//   並列Web調査＋敵対的検証済み）を正規化したもの。research-catalog で随時更新される。
// ----------------------------------------------------------------------------
export const CATALOG_PROGRAMS: CatalogProgram[] = (
  rawPrograms as unknown as RawProgram[]
).map(fromResearchRecord);
