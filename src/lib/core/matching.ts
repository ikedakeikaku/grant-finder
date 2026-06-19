/**
 * 事業者プロフィール × 補助金 のマッチング（純粋関数）。
 *
 * 設計方針:
 *  - 地域・業種・従業員規模は「対象外なら不適格(eligible=false, score=0)」のハードゲート。
 *    ただし補助金側に制約が無い/プロフィールが空で判定不能なときは不適格にしない（安全側）。
 *  - 適格なものの中で、目的・関心の合致度でスコア(0..1)を付ける。
 *  - reasons には人間が読める根拠を積む（提案メール・画面表示に使う）。
 */

/** マッチング入力: 事業者プロフィール */
export interface BusinessProfile {
  industry: string | null;
  prefecture: string | null;
  city: string | null;
  employeeCount: number | null;
  purposes: string[];
  interests: string[];
}

/** マッチング入力: 補助金（正規化済みフィールドの一部） */
export interface SubsidyForMatch {
  usePurpose: string | null;
  industry: string | null;
  targetAreaSearch: string | null;
  targetNumberOfEmployees: string | null;
  title: string;
  catchPhrase: string | null;
}

export interface MatchResult {
  eligible: boolean;
  score: number; // 0..1
  reasons: string[];
}

// --- 地域 ---------------------------------------------------------------

/**
 * 対象地域に該当するか。制約なし(全国/空)や所在地不明は true（不適格にしない）。
 * 都道府県だけでなく市区町村も見て、自治体補助金を拾えるようにする。
 */
export function isAreaEligible(
  targetAreaSearch: string | null,
  prefecture: string | null,
  city: string | null = null,
): boolean {
  if (!targetAreaSearch) return true;
  if (targetAreaSearch.includes("全国")) return true;
  if (prefecture && targetAreaSearch.includes(prefecture)) return true;
  if (city && targetAreaSearch.includes(city)) return true;
  if (!prefecture && !city) return true; // 所在地不明なら判定不能 → 除外しない
  return false;
}

// --- 業種 ---------------------------------------------------------------

export interface IndustryMatch {
  restricted: boolean; // 補助金が業種を限定しているか
  match: boolean; // プロフィール業種が対象に含まれるか（限定時のみ意味を持つ）
}

/**
 * これ以上の業種数を列挙している補助金は「ほぼ全業種対象」とみなし、
 * 業種での絞り込み（restricted）として扱わない。全業種タグは関連性の信号に
 * ならず、業種ボーナスで無関係な補助金が上位に来る原因になるため。
 */
export const UNIVERSAL_INDUSTRY_THRESHOLD = 15;

/** 補助金の industry は "建設業 / 製造業 / ..." のようなスラッシュ区切り。 */
export function matchIndustry(
  subsidyIndustry: string | null,
  businessIndustry: string | null,
): IndustryMatch {
  const list = (subsidyIndustry ?? "")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  // 業種指定なし、または事実上の全業種は「限定なし」とみなす。
  if (list.length === 0 || list.length >= UNIVERSAL_INDUSTRY_THRESHOLD) {
    return { restricted: false, match: false };
  }
  if (!businessIndustry) return { restricted: true, match: false };
  return { restricted: true, match: list.includes(businessIndustry.trim()) };
}

// --- 従業員規模 ---------------------------------------------------------

export type EmployeeCeiling =
  | { kind: "unlimited" }
  | { kind: "unknown" }
  | { kind: "limit"; max: number; inclusive: boolean };

/** "従業員数の制約なし" / "従業員20人以下" / "300名未満" 等を解釈する。 */
export function parseEmployeeCeiling(text: string | null): EmployeeCeiling {
  if (!text) return { kind: "unknown" };
  if (text.includes("制約なし") || text.includes("制限なし")) {
    return { kind: "unlimited" };
  }
  const m = text.match(/([0-9,]+)\s*(?:人|名)\s*(以下|まで|以内|未満)/);
  if (m && m[1]) {
    const max = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(max)) {
      return { kind: "limit", max, inclusive: m[2] !== "未満" };
    }
  }
  return { kind: "unknown" };
}

/** 従業員規模が対象内か。判定不能・上限不明・人数未入力は true（除外しない）。 */
export function isSizeEligible(
  targetNumberOfEmployees: string | null,
  employeeCount: number | null,
): boolean {
  const ceiling = parseEmployeeCeiling(targetNumberOfEmployees);
  if (ceiling.kind !== "limit") return true;
  if (employeeCount == null) return true;
  return ceiling.inclusive
    ? employeeCount <= ceiling.max
    : employeeCount < ceiling.max;
}

// --- 関心キーワード -----------------------------------------------------

/** haystack（題名・キャッチ・目的）に1つでも含まれる関心語を返す。 */
export function matchedInterests(
  interests: string[],
  haystack: string,
): string[] {
  return interests.filter((kw) => kw.length > 0 && haystack.includes(kw));
}

// --- 総合スコア ---------------------------------------------------------

const WEIGHTS = {
  base: 0.25, // 適格であることの基礎点
  purpose: 0.45, // 目的の合致（最重要）
  industry: 0.15, // 業種が明示的に対象
  interest: 0.15, // 関心語の合致
  local: 0.1, // 地元自治体の補助金
} as const;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * 事業者プロフィールと補助金の適合度を算出する。
 */
export function scoreMatch(
  profile: BusinessProfile,
  subsidy: SubsidyForMatch,
): MatchResult {
  const reasons: string[] = [];

  // ハードゲート
  const areaOk = isAreaEligible(
    subsidy.targetAreaSearch,
    profile.prefecture,
    profile.city,
  );
  // 自治体補助金（全国以外で所在地が対象）は地元として軽く加点する。
  const isLocal =
    !!subsidy.targetAreaSearch &&
    !subsidy.targetAreaSearch.includes("全国") &&
    ((!!profile.prefecture &&
      subsidy.targetAreaSearch.includes(profile.prefecture)) ||
      (!!profile.city && subsidy.targetAreaSearch.includes(profile.city)));
  const industry = matchIndustry(subsidy.industry, profile.industry);
  const sizeOk = isSizeEligible(
    subsidy.targetNumberOfEmployees,
    profile.employeeCount,
  );
  const industryOk = !industry.restricted || industry.match;

  if (!areaOk || !industryOk || !sizeOk) {
    const ng: string[] = [];
    if (!areaOk) ng.push("対象地域外");
    if (!industryOk) ng.push("対象業種外");
    if (!sizeOk) ng.push("従業員規模が対象外");
    return { eligible: false, score: 0, reasons: ng };
  }

  // 適格。スコアを積み上げる。
  let score = WEIGHTS.base;
  if (isLocal) {
    // 地元自治体の補助金は競争が緩く採択されやすいので軽く加点。
    score += WEIGHTS.local;
    reasons.push(`地元自治体の補助金（${profile.city ?? profile.prefecture}）`);
  } else if (subsidy.targetAreaSearch?.includes("全国")) {
    reasons.push("全国対象");
  }

  // 目的の合致（補助金の use_purpose に含まれるプロフィール目的の割合）
  const purposeHits = profile.purposes.filter(
    (p) => p.length > 0 && (subsidy.usePurpose ?? "").includes(p),
  );
  if (profile.purposes.length > 0 && purposeHits.length > 0) {
    score += WEIGHTS.purpose * (purposeHits.length / profile.purposes.length);
    reasons.push(`目的が合致（${purposeHits.join("・")}）`);
  }

  // 業種が明示的に対象
  if (industry.restricted && industry.match && profile.industry) {
    score += WEIGHTS.industry;
    reasons.push(`業種が対象に含まれる（${profile.industry}）`);
  }

  // 関心語の合致
  const haystack = `${subsidy.title} ${subsidy.catchPhrase ?? ""} ${
    subsidy.usePurpose ?? ""
  }`;
  const hitInterests = matchedInterests(profile.interests, haystack);
  if (hitInterests.length > 0) {
    score += WEIGHTS.interest;
    reasons.push(`関心に合致（${hitInterests.join("・")}）`);
  }

  return { eligible: true, score: clamp01(score), reasons };
}

// --- 複数補助金からの提案生成 -------------------------------------------

export interface ScoredMatch {
  subsidyId: string;
  score: number;
  reasons: string[];
}

export interface GenerateMatchesOptions {
  /** これ未満のスコアは提案しない（既定 0.3） */
  minScore?: number;
  /** 上位何件まで提案するか（既定 20） */
  limit?: number;
}

/**
 * プロフィールに対し、複数の補助金から「適格かつスコアが閾値以上」の提案を
 * スコア降順で返す純粋関数。同点は score の安定性のため id 昇順で並べる。
 */
export function generateMatches(
  profile: BusinessProfile,
  subsidies: Array<SubsidyForMatch & { id: string }>,
  options: GenerateMatchesOptions = {},
): ScoredMatch[] {
  const minScore = options.minScore ?? 0.3;
  const limit = options.limit ?? 20;

  return subsidies
    .map((s) => {
      const r = scoreMatch(profile, s);
      return {
        subsidyId: s.id,
        score: r.score,
        reasons: r.reasons,
        eligible: r.eligible,
      };
    })
    .filter((m) => m.eligible && m.score >= minScore)
    .sort((a, b) => b.score - a.score || a.subsidyId.localeCompare(b.subsidyId))
    .slice(0, limit)
    .map(({ subsidyId, score, reasons }) => ({ subsidyId, score, reasons }));
}
