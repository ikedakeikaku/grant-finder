import "./load-env";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";
import { CURATED_PROGRAMS, findOpenRound } from "../src/lib/curated";
import { computeSubsidyStatus } from "../src/lib/jgrants/normalize";

/**
 * 主要制度のキュレーション反映バッチ。
 *   1. jGrants が入れた不正確な同制度エントリを subsidies から削除（抑制）
 *   2. 公式の各回日程を subsidy_schedules(source=manual) へ蓄積（予測の学習元）
 *   3. 現在応募できる回があれば subsidies に curated 行を upsert、なければ削除
 * 日次パイプラインでは ingest の直後に実行する。
 */
async function main(): Promise<void> {
  const now = new Date();
  const admin = createSupabaseAdminClient();

  for (const p of CURATED_PROGRAMS) {
    // 1. jGrants の同制度エントリを削除（curated: 行は残す）
    for (const term of p.titleMatch) {
      const { error } = await admin
        .from("subsidies")
        .delete()
        .ilike("title", `%${term}%`)
        .not("id", "like", "curated:%");
      if (error) throw new Error(`jGrants抑制削除 失敗: ${error.message}`);
    }

    // 2. この制度は手動データを正本にする。既存の履歴・予測を一旦全削除して作り直す。
    const { error: dsErr } = await admin
      .from("subsidy_schedules")
      .delete()
      .eq("schedule_key", p.scheduleKey);
    if (dsErr) throw new Error(`履歴削除 失敗: ${dsErr.message}`);
    const { error: dpErr } = await admin
      .from("subsidy_predictions")
      .delete()
      .eq("schedule_key", p.scheduleKey);
    if (dpErr) throw new Error(`予測削除 失敗: ${dpErr.message}`);

    // 公式日程を subsidy_schedules(manual) へ
    const schedRows = p.rounds.map((r) => ({
      schedule_key: p.scheduleKey,
      name: p.name,
      acceptance_start: r.publicationStart,
      acceptance_end: r.applicationEnd,
      source: "manual",
    }));
    const { error: sErr } = await admin
      .from("subsidy_schedules")
      .insert(schedRows);
    if (sErr) throw new Error(`manual schedules insert 失敗: ${sErr.message}`);

    // 3. 現在応募できる回があればライブ行、なければ削除
    const id = `curated:${p.slug}`;
    const open = findOpenRound(p, now);
    if (open) {
      const start = new Date(open.publicationStart);
      const end = new Date(open.applicationEnd);
      const { error } = await admin.from("subsidies").upsert(
        {
          id,
          name: null,
          title: `${p.name}（${open.label}）`,
          catch_phrase: null,
          detail: null,
          use_purpose: p.usePurpose,
          industry: null,
          target_area_search: p.areaSearch,
          target_area_detail: null,
          target_number_of_employees: p.targetNumberOfEmployees,
          subsidy_rate: p.subsidyRate,
          subsidy_max_limit: p.subsidyMaxLimit,
          acceptance_start_datetime: start.toISOString(),
          acceptance_end_datetime: end.toISOString(),
          project_end_deadline: null,
          institution_name: null,
          front_subsidy_detail_page_url: p.detailUrl,
          status: computeSubsidyStatus(start, end, now),
          schedule_key: p.scheduleKey,
          raw: null,
          last_seen_at: now.toISOString(),
        },
        { onConflict: "id" },
      );
      if (error)
        throw new Error(`curated subsidy upsert 失敗: ${error.message}`);
      console.log(`[curated] ${p.name}: ライブ(${open.label})`);
    } else {
      const { error } = await admin.from("subsidies").delete().eq("id", id);
      if (error) throw new Error(`curated subsidy 削除 失敗: ${error.message}`);
      console.log(`[curated] ${p.name}: 現在公募なし → 予測に回す`);
    }
  }
  console.log("[done] キュレーション反映完了");
}

main().catch((err) => {
  console.error("[error]", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
