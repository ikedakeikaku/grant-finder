import "./load-env";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";
import { CATALOG_PROGRAMS, toProgramRow } from "../src/lib/catalog/programs";

/**
 * 制度マスタ(programs)のシード反映バッチ。
 * `src/lib/catalog/programs.ts` の CATALOG_PROGRAMS を programs テーブルへ upsert する。
 * Web調査(research-catalog)が後から各制度の予算・日程・要件を更新していく。
 */
async function main(): Promise<void> {
  const admin = createSupabaseAdminClient();
  const rows = CATALOG_PROGRAMS.map(toProgramRow);

  if (rows.length === 0) {
    console.log("[seed-programs] シードが空です");
    return;
  }

  const { error } = await admin
    .from("programs")
    .upsert(rows, { onConflict: "id" });
  if (error) throw new Error(`programs upsert 失敗: ${error.message}`);

  console.log(`[seed-programs] ${rows.length}件の制度を反映しました`);
}

main().catch((err) => {
  console.error("[error]", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
