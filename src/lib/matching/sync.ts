import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generateMatches,
  type BusinessProfile,
  type SubsidyForMatch,
} from "../core/matching";
import { isApplicationOffering } from "../core/offering";
import { dedupeByScheduleKey } from "../core/dedupe";
import { PREFECTURES } from "../core/constants";
import { isCuratedJgrantsTitle } from "../curated";

/** LLMに渡す予測候補の上限（max_tokens対策＋ノイズ削減） */
const PREDICTION_CANDIDATE_POOL = 80;
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
  city: string | null;
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
      "id, name, schedule_key, acceptance_end_datetime, use_purpose, industry, target_area_search, target_number_of_employees, title, catch_phrase",
    )
    .in("status", ["open", "closing_soon"]);
  if (error) throw new Error(`subsidies 取得失敗: ${error.message}`);

  // 新規応募できる公募のみ。キュレーション対象のjGrantsエントリ(不正確)は抑制。
  // → 同一制度は締切が最も近い回次だけに名寄せ。
  const offerings = (data ?? [])
    .filter((s) => isApplicationOffering(s.title, s.name))
    .filter(
      (s) =>
        String(s.id).startsWith("curated:") || !isCuratedJgrantsTitle(s.title),
    )
    .map((s) => ({
      id: s.id,
      scheduleKey: s.schedule_key,
      acceptanceEnd: s.acceptance_end_datetime,
      usePurpose: s.use_purpose,
      industry: s.industry,
      targetAreaSearch: s.target_area_search,
      targetNumberOfEmployees: s.target_number_of_employees,
      title: s.title,
      catchPhrase: s.catch_phrase,
    }));

  return dedupeByScheduleKey(offerings).map((s) => ({
    id: s.id,
    usePurpose: s.usePurpose,
    industry: s.industry,
    targetAreaSearch: s.targetAreaSearch,
    targetNumberOfEmployees: s.targetNumberOfEmployees,
    title: s.title,
    catchPhrase: s.catchPhrase,
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
    city: business.city,
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

/** 予測として提案する上限件数 */
export const PREDICTED_LIMIT = 5;

export interface ActivePrediction {
  id: string;
  name: string;
  confidence: number;
}

/** 有効な公募前予測を取得する（信頼度の高い順）。 */
export async function fetchActivePredictions(
  admin: SupabaseClient,
): Promise<ActivePrediction[]> {
  const { data, error } = await admin
    .from("subsidy_predictions")
    .select("id, name, confidence")
    .eq("active", true)
    .order("confidence", { ascending: false });
  if (error) throw new Error(`subsidy_predictions 取得失敗: ${error.message}`);
  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    confidence: Number(p.confidence ?? 0),
  }));
}

/** 事業内容に由来する素朴なキーワード（予測名との関連ヒント用） */
function businessKeywords(business: BusinessMatchInput): string[] {
  const out = new Set<string>();
  for (const i of business.interests ?? []) if (i.length >= 2) out.add(i);
  if (business.industry) {
    const core = business.industry
      .replace(/（[^）]*）/g, "")
      .replace(/業$/, "")
      .trim();
    if (core.length >= 2) out.add(core);
  }
  for (const p of business.purposes ?? []) {
    const core = p
      .replace(/(を行いたい|をしたい|したい|を広げたい|を改善したい)$/, "")
      .trim();
    if (core.length >= 2) out.add(core);
  }
  return [...out];
}

/**
 * 予測候補をLLMに渡す前に決定論で間引く。
 * - 事業者の所在地以外の都道府県名を含む（=他県限定）ものは除外。
 * - 事業内容との関連ヒント（名称へのキーワード一致数）を優先し、次に信頼度。
 *   信頼度だけで切ると、関連は高いが低信頼度の制度を取りこぼすため。
 */
function prefilterPredictions(
  predictions: ActivePrediction[],
  business: BusinessMatchInput,
): ActivePrediction[] {
  const prefecture = business.prefecture;
  const otherPrefs = prefecture
    ? PREFECTURES.filter((p) => p !== prefecture)
    : [];
  const kws = businessKeywords(business);
  const hint = (name: string) => kws.filter((k) => name.includes(k)).length;

  return predictions
    .filter((p) => {
      if (!prefecture) return true;
      if (p.name.includes(prefecture)) return true;
      return !otherPrefs.some((op) => p.name.includes(op));
    })
    .map((p) => ({ p, h: hint(p.name) }))
    .sort((a, b) => b.h - a.h || b.p.confidence - a.p.confidence)
    .slice(0, PREDICTION_CANDIDATE_POOL)
    .map((x) => x.p);
}

/**
 * 1事業者について「公募前予測」の提案(kind=predicted)を再構築する。
 * 予測は制度名しか構造化情報がないため、LLM関連性判定で事業内容に合うものだけ採用。
 * LLM未設定時は予測提案を作らない（=既存を消す）。
 */
export async function syncPredictedMatchesForBusiness(
  admin: SupabaseClient,
  business: BusinessMatchInput,
  predictions: ActivePrediction[],
): Promise<number> {
  let rows: Array<{
    business_id: string;
    kind: "predicted";
    prediction_id: string;
    score: number;
    reasons: string[];
  }> = [];

  const pool = prefilterPredictions(predictions, business);
  if (isRelevanceEnabled() && pool.length > 0) {
    try {
      const profile: BusinessProfile = {
        industry: business.industry,
        prefecture: business.prefecture,
        city: business.city,
        employeeCount: business.employee_count,
        purposes: business.purposes ?? [],
        interests: business.interests ?? [],
      };
      const cands: RelevanceCandidate[] = pool.map((p) => ({
        id: p.id,
        title: p.name,
        catchPhrase: null,
        usePurpose: null,
      }));
      const ranked = await rankRelevance(
        {
          ...profile,
          description: business.description ?? null,
          plannedInvestment: business.planned_investment ?? null,
        },
        cands,
      );
      const relById = new Map(ranked.map((r) => [r.id, r]));
      rows = predictions
        .map((p) => ({ p, rel: relById.get(p.id) }))
        .filter((x) => x.rel && x.rel.relevance >= RELEVANCE_THRESHOLD)
        .sort((a, b) => b.rel!.relevance - a.rel!.relevance)
        .slice(0, PREDICTED_LIMIT)
        .map((x) => ({
          business_id: business.id,
          kind: "predicted" as const,
          prediction_id: x.p.id,
          score: x.rel!.relevance,
          reasons: [x.rel!.reason],
        }));
    } catch (e) {
      console.error(
        "[relevance] 予測のLLM評価に失敗:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  if (rows.length > 0) {
    const { error } = await admin
      .from("matches")
      .upsert(rows, { onConflict: "business_id,prediction_id" });
    if (error)
      throw new Error(`predicted matches upsert 失敗: ${error.message}`);
  }

  const keepIds = rows.map((r) => r.prediction_id);
  let del = admin
    .from("matches")
    .delete()
    .eq("business_id", business.id)
    .eq("kind", "predicted");
  if (keepIds.length > 0) {
    del = del.not("prediction_id", "in", `(${keepIds.join(",")})`);
  }
  const { error: delErr } = await del;
  if (delErr)
    throw new Error(`古い predicted matches 削除失敗: ${delErr.message}`);

  return rows.length;
}
