import "./load-env";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";
import {
  generateMatches,
  type BusinessProfile,
  type SubsidyForMatch,
} from "../src/lib/core/matching";

/**
 * マッチ生成バッチ。
 *   全 businesses × 受付中(open/closing_soon)の subsidies で提案を作り、
 *   matches(kind='open') へ upsert する。スコア/根拠は再計算で更新。
 * 純粋なスコアリングは src/lib/core/matching.ts に委譲（ここはI/Oの殻）。
 */

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main(): Promise<void> {
  const supabase = createSupabaseAdminClient();

  const { data: businesses, error: bErr } = await supabase
    .from("businesses")
    .select("id, industry, prefecture, employee_count, purposes, interests");
  if (bErr) throw new Error(`businesses 取得失敗: ${bErr.message}`);

  const { data: subs, error: sErr } = await supabase
    .from("subsidies")
    .select(
      "id, use_purpose, industry, target_area_search, target_number_of_employees, title, catch_phrase",
    )
    .in("status", ["open", "closing_soon"]);
  if (sErr) throw new Error(`subsidies 取得失敗: ${sErr.message}`);

  const subsForMatch: Array<SubsidyForMatch & { id: string }> = (
    subs ?? []
  ).map((s) => ({
    id: s.id,
    usePurpose: s.use_purpose,
    industry: s.industry,
    targetAreaSearch: s.target_area_search,
    targetNumberOfEmployees: s.target_number_of_employees,
    title: s.title,
    catchPhrase: s.catch_phrase,
  }));

  const rows: Array<{
    business_id: string;
    kind: "open";
    subsidy_id: string;
    score: number;
    reasons: string[];
  }> = [];

  for (const b of businesses ?? []) {
    const profile: BusinessProfile = {
      industry: b.industry,
      prefecture: b.prefecture,
      employeeCount: b.employee_count,
      purposes: (b.purposes ?? []) as string[],
      interests: (b.interests ?? []) as string[],
    };
    for (const m of generateMatches(profile, subsForMatch)) {
      rows.push({
        business_id: b.id,
        kind: "open",
        subsidy_id: m.subsidyId,
        score: m.score,
        reasons: m.reasons,
      });
    }
  }

  let upserted = 0;
  for (const batch of chunk(rows, 200)) {
    const { error } = await supabase
      .from("matches")
      .upsert(batch, { onConflict: "business_id,subsidy_id" });
    if (error) throw new Error(`matches upsert 失敗: ${error.message}`);
    upserted += batch.length;
  }
  console.log(
    `[matches] businesses=${businesses?.length ?? 0} subsidies=${subsForMatch.length} -> upsert ${upserted}件`,
  );
}

main().catch((err) => {
  console.error("[error]", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
