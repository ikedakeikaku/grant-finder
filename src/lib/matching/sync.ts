import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generateMatches,
  type BusinessProfile,
  type SubsidyForMatch,
} from "../core/matching";
import { isApplicationOffering } from "../core/offering";

/** 1事業者あたりに提案する上限件数 */
export const MATCH_LIMIT = 10;

/**
 * マッチ生成のDB連携（build-matches バッチと登録アクションで共用）。
 * スコアリングそのものは src/lib/core/matching.ts の純粋関数に委譲する。
 */

export interface BusinessMatchInput {
  id: string;
  industry: string | null;
  prefecture: string | null;
  employee_count: number | null;
  purposes: string[] | null;
  interests: string[] | null;
}

export type SubsidyForMatchWithId = SubsidyForMatch & { id: string };

/** 受付中(open/closing_soon)の補助金をマッチング用の形で取得する。 */
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

/** 1事業者について提案を再計算し matches へ upsert する。返り値は upsert 件数。 */
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
  const rows = generateMatches(profile, subsidies, { limit: MATCH_LIMIT }).map(
    (m) => ({
      business_id: business.id,
      kind: "open" as const,
      subsidy_id: m.subsidyId,
      score: m.score,
      reasons: m.reasons,
    }),
  );

  if (rows.length > 0) {
    const { error } = await admin
      .from("matches")
      .upsert(rows, { onConflict: "business_id,subsidy_id" });
    if (error) throw new Error(`matches upsert 失敗: ${error.message}`);
  }

  // 今回の提案に含まれない open マッチ（資格を失った/事務手続き等の残骸）を削除する。
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
