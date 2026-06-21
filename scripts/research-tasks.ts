import "./load-env";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";

/**
 * 調査待ち(proposal_status='needs_research')の事業者一覧を JSON で出力する。
 * Claude Code(定額) がこれを読み、Web調査して scripts/import-research.ts で書き戻す。
 * 既存カタログの制度名も同梱して重複発掘を避ける。
 *
 * 使い方: pnpm research:tasks  （結果は stdout に JSON）
 */
async function main(): Promise<void> {
  const admin = createSupabaseAdminClient();

  const { data: bizs, error } = await admin
    .from("businesses")
    .select(
      "id, name, industry, prefecture, city, employee_count, annual_revenue, founded_year, purposes, interests, description, planned_investment",
    )
    .eq("proposal_status", "needs_research")
    .eq("lead_status", "approved");
  if (error) throw new Error(`businesses 取得失敗: ${error.message}`);

  const { data: progs, error: pErr } = await admin
    .from("programs")
    .select("id, name, prefecture, level")
    .in("status", ["active", "watch"]);
  if (pErr) throw new Error(`programs 取得失敗: ${pErr.message}`);

  const out = {
    generatedAt: new Date().toISOString(),
    pending: bizs ?? [],
    existingPrograms: (progs ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      prefecture: p.prefecture,
      level: p.level,
    })),
  };
  // stdout は JSON のみ（Claude Code がそのまま読めるよう）。
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error("[error]", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
