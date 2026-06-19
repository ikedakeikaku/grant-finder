import "./load-env";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";
import {
  fetchOpenSubsidiesForMatch,
  syncMatchesForBusiness,
  type BusinessMatchInput,
} from "../src/lib/matching/sync";

/**
 * マッチ生成バッチ。全 businesses × 受付中の subsidies で提案を作り直す。
 * ロジックは src/lib/matching/sync.ts（および純粋な src/lib/core/matching.ts）に委譲。
 */
async function main(): Promise<void> {
  const admin = createSupabaseAdminClient();

  const subsidies = await fetchOpenSubsidiesForMatch(admin);

  const { data: businesses, error } = await admin
    .from("businesses")
    .select(
      "id, industry, prefecture, employee_count, purposes, interests, description, planned_investment",
    );
  if (error) throw new Error(`businesses 取得失敗: ${error.message}`);

  let total = 0;
  for (const b of (businesses ?? []) as BusinessMatchInput[]) {
    total += await syncMatchesForBusiness(admin, b, subsidies);
  }

  console.log(
    `[matches] businesses=${businesses?.length ?? 0} subsidies=${subsidies.length} -> upsert ${total}件`,
  );
}

main().catch((err) => {
  console.error("[error]", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
