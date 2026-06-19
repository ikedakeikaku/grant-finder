import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generateMatches,
  type BusinessProfile,
  type SubsidyForMatch,
} from "../core/matching";
import { isApplicationOffering } from "../core/offering";
import {
  isRelevanceEnabled,
  rankRelevance,
  type RelevanceCandidate,
} from "./relevance";

/** 1事業者あたりに提案する上限件数 */
export const MATCH_LIMIT = 10;
/** LLM 関連性ランクにかける候補プールの上限 */
const CANDIDATE_POOL = 60;
/** 提案として採用する最低スコア（決定論・LLM共通の足切り） */
const MIN_SCORE = 0.3;
/** LLM 関連性で採用する閾値 */
const RELEVANCE_THRESHOLD = 0.5;

export interface BusinessMatchInput {
  id: string;
  industry: string | null;
  prefecture: string | null;
  employee_count: number | null;
  purposes: string[] | null;
  interests: string[] | null;
  description?: string | null;
  planned_investment?: string | null;
}

export type SubsidyForMatchWithId = SubsidyForMatch & { id: string };

/** 受付中(open/closing_soon)かつ新規応募可能な補助金をマッチング用に取得する。 */
export async function fetchOpenSubsidiesForMatch(
  admin: SupabaseClient,
): Promise<SubsidyForMatchWithId[]> {
  const { data, error } = await admin
    .from("subsidies")
    .select(
      "id, name, use_purpose, industry, target_area_search, target_number_of_employees, title, catch_phrase",
    )
    .in("status", ["open", "closing_soon"]);
  if (error) throw new Error(`subsidies 取得失敗: ${error.message}`);
  return (data ?? [])
    .filter((s) => isApplicationOffering(s.title, s.name))
    .map((s) => ({
      id: s.id,
      usePurpose: s.use_purpose,
      industry: s.industry,
      targetAreaSearch: s.target_area_search,
      targetNumberOfEmployees: s.target_number_of_employees,
      title: s.title,
      catchPhrase: s.catch_phrase,
    }));
}

interface MatchRow {
  business_id: string;
  kind: "open";
  subsidy_id: string;
  score: number;
  reasons: string[];
}

/** 1事業者について提案を再計算し matches へ反映する。返り値は採用件数。 */
export async function syncMatchesForBusiness(
  admin: SupabaseClient,
  business: BusinessMatchInput,
  subsidies: SubsidyForMatchWithId[],
): Promise<number> {
  const profile: BusinessProfile = {
    industry: business.industry,
    prefecture: business.prefecture,
    employeeCount: business.employee_count,
    purposes: business.purposes ?? [],
    interests: business.interests ?? [],
  };

  // 決定論で適格な候補プール（広め）。
  const candidates = generateMatches(profile, subsidies, {
    minScore: MIN_SCORE,
    limit: CANDIDATE_POOL,
  });
  const byId = new Map(subsidies.map((s) => [s.id, s]));

  // LLM が使えれば関連性で厳選、ダメなら決定論の上位を採用。
  let rows: MatchRow[] = candidates.slice(0, MATCH_LIMIT).map((m) => ({
    business_id: business.id,
    kind: "open",
    subsidy_id: m.subsidyId,
    score: m.score,
    reasons: m.reasons,
  }));

  if (isRelevanceEnabled() && candidates.length > 0) {
    try {
      const relCandidates: RelevanceCandidate[] = candidates.map((m) => {
        const s = byId.get(m.subsidyId);
        return {
          id: m.subsidyId,
          title: s?.title ?? "",
          catchPhrase: s?.catchPhrase ?? null,
          usePurpose: s?.usePurpose ?? null,
        };
      });
      const ranked = await rankRelevance(
        {
          ...profile,
          description: business.description ?? null,
          plannedInvestment: business.planned_investment ?? null,
        },
        relCandidates,
      );
      const relById = new Map(ranked.map((r) => [r.id, r]));
      rows = candidates
        .map((m) => ({ m, rel: relById.get(m.subsidyId) }))
        .filter((x) => x.rel && x.rel.relevance >= RELEVANCE_THRESHOLD)
        .sort((a, b) => b.rel!.relevance - a.rel!.relevance)
        .slice(0, MATCH_LIMIT)
        .map((x) => ({
          business_id: business.id,
          kind: "open" as const,
          subsidy_id: x.m.subsidyId,
          score: x.rel!.relevance,
          reasons: [x.rel!.reason],
        }));
    } catch (e) {
      console.error(
        "[relevance] LLM評価に失敗、決定論にフォールバック:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  if (rows.length > 0) {
    const { error } = await admin
      .from("matches")
      .upsert(rows, { onConflict: "business_id,subsidy_id" });
    if (error) throw new Error(`matches upsert 失敗: ${error.message}`);
  }

  // 今回の提案に含まれない open マッチ（失効・無関連の残骸）を削除する。
  const keepIds = rows.map((r) => r.subsidy_id);
  let del = admin
    .from("matches")
    .delete()
    .eq("business_id", business.id)
    .eq("kind", "open");
  if (keepIds.length > 0) {
    del = del.not("subsidy_id", "in", `(${keepIds.join(",")})`);
  }
  const { error: delErr } = await del;
  if (delErr) throw new Error(`古い matches 削除失敗: ${delErr.message}`);

  return rows.length;
}
