import "./load-env";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";
import {
  applyBudgetSignal,
  predictNextOpening,
  type BudgetSignalKind,
} from "../src/lib/core/prediction";

/**
 * 公募前予測の生成バッチ。
 *   subsidy_schedules(履歴) を schedule_key ごとに集計し、例年の開始月から次回公募を予測。
 *   現在公募中の制度（live な subsidies がある）は除外（既にライブ提案で出るため）。
 *   結果を subsidy_predictions へ upsert。
 */

interface ScheduleRow {
  schedule_key: string | null;
  name: string;
  acceptance_start: string | null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main(): Promise<void> {
  const now = new Date();
  const admin = createSupabaseAdminClient();

  // 履歴（PostgRESTの既定上限1000行を超えるためページネーションで全件取得）
  const schedules: ScheduleRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("subsidy_schedules")
      .select("schedule_key, name, acceptance_start")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`subsidy_schedules 取得失敗: ${error.message}`);
    const page = (data ?? []) as ScheduleRow[];
    schedules.push(...page);
    if (page.length < PAGE) break;
  }

  // 現在公募中の制度キー（予測対象から除外）
  const { data: openData, error: oErr } = await admin
    .from("subsidies")
    .select("schedule_key")
    .in("status", ["open", "closing_soon"]);
  if (oErr) throw new Error(`subsidies 取得失敗: ${oErr.message}`);
  const openKeys = new Set(
    (openData ?? [])
      .map((r: { schedule_key: string | null }) => r.schedule_key)
      .filter((k): k is string => !!k),
  );

  // 予算動向シグナル（概算要求/補正/当初予算）。schedule_key ごとに最新の1件を採用。
  const { data: sigData, error: sErr } = await admin
    .from("budget_signals")
    .select("schedule_key, kind, detected_at, status")
    .neq("status", "dismissed");
  if (sErr) throw new Error(`budget_signals 取得失敗: ${sErr.message}`);
  const sigByKey = new Map<
    string,
    { kind: BudgetSignalKind; detectedAt: Date }
  >();
  for (const s of (sigData ?? []) as Array<{
    schedule_key: string | null;
    kind: BudgetSignalKind;
    detected_at: string | null;
  }>) {
    if (!s.schedule_key) continue;
    const detectedAt = new Date(s.detected_at ?? 0);
    const cur = sigByKey.get(s.schedule_key);
    if (!cur || detectedAt > cur.detectedAt)
      sigByKey.set(s.schedule_key, { kind: s.kind, detectedAt });
  }

  // schedule_key ごとに集計
  const byKey = new Map<string, { name: string; starts: Date[] }>();
  for (const s of schedules) {
    if (!s.schedule_key || !s.acceptance_start) continue;
    const g = byKey.get(s.schedule_key) ?? { name: s.name, starts: [] };
    g.starts.push(new Date(s.acceptance_start));
    // 表示名は最新のものを優先（後勝ち）
    g.name = s.name;
    byKey.set(s.schedule_key, g);
  }

  const rows: Array<Record<string, unknown>> = [];
  let skippedOpen = 0;
  let withSignal = 0;
  for (const [key, g] of byKey.entries()) {
    if (openKeys.has(key)) {
      skippedOpen++;
      continue; // 現在公募中はライブ提案に任せる
    }
    const base = predictNextOpening(g.starts, now);
    if (!base) continue;
    // 予算動向シグナルがあれば反映（信頼度を上げ根拠に明記）。
    const sig = sigByKey.get(key);
    if (sig) withSignal++;
    const p = applyBudgetSignal(base, sig?.kind ?? null, sig?.detectedAt ?? null);
    rows.push({
      schedule_key: key,
      name: g.name,
      fiscal_year: p.from.getUTCFullYear(),
      predicted_start_from: p.from.toISOString(),
      predicted_start_to: p.to.toISOString(),
      confidence: p.confidence,
      basis: p.basis,
      sample_size: p.sampleSize,
      active: true,
    });
  }

  let upserted = 0;
  for (const batch of chunk(rows, 100)) {
    const { error } = await admin
      .from("subsidy_predictions")
      .upsert(batch, { onConflict: "schedule_key,fiscal_year" });
    if (error)
      throw new Error(`subsidy_predictions upsert 失敗: ${error.message}`);
    upserted += batch.length;
  }

  console.log(
    `[predict] 制度数=${byKey.size} 現公募で除外=${skippedOpen} 予算反映=${withSignal}件 予測生成=${upserted}件`,
  );
}

main().catch((err) => {
  console.error("[error]", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
