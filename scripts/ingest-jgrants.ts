import "./load-env";
import { JGrantsClient } from "../src/lib/jgrants/client";
import { normalizeSubsidy } from "../src/lib/jgrants/normalize";
import type { NormalizedSubsidy } from "../src/lib/jgrants/normalize";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";

/**
 * jGrants 取込バッチ。
 *   1. 既定キーワードで一覧APIを引き、ID を名寄せ
 *   2. 各 ID の詳細を取得して正規化
 *   3. subsidies へ upsert（last_seen_at を更新）
 *   4. 公募履歴を subsidy_schedules へ蓄積（予測の学習元）
 *
 * cron(GitHub Actions) から日次実行する想定。DB 書き込みはサービスロール。
 */

const KEYWORDS = (process.env.JGRANTS_INGEST_KEYWORDS ?? "補助金,助成金")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length >= 2);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main(): Promise<void> {
  const now = new Date();
  const client = new JGrantsClient();
  const supabase = createSupabaseAdminClient();

  // 1. 一覧から受付中の補助金 ID を収集（キーワード横断で名寄せ）
  const ids = new Set<string>();
  for (const keyword of KEYWORDS) {
    const items = await client.listSubsidies({ keyword, acceptance: 1 });
    for (const it of items) ids.add(it.id);
    console.log(`[list] keyword=${keyword} -> ${items.length}件`);
    await sleep(300);
  }
  console.log(`[list] 名寄せ後のユニークID: ${ids.size}件`);

  // 2-3. 詳細取得→正規化
  const rows: (NormalizedSubsidy & { last_seen_at: string })[] = [];
  for (const id of ids) {
    const detail = await client.getSubsidyDetail(id);
    if (!detail) continue;
    rows.push({
      ...normalizeSubsidy(detail, now),
      last_seen_at: now.toISOString(),
    });
    await sleep(200);
  }
  console.log(`[detail] 正規化完了: ${rows.length}件`);

  // 3. subsidies へ upsert（id 競合で更新。first_seen_at は payload に含めず初回値を保持）
  // raw は添付の base64 を除去済みだが、無料プランの文タイムアウト回避のため小さめに分割。
  let upserted = 0;
  for (const batch of chunk(rows, 50)) {
    const { error } = await supabase
      .from("subsidies")
      .upsert(batch, { onConflict: "id" });
    if (error) throw new Error(`subsidies upsert 失敗: ${error.message}`);
    upserted += batch.length;
  }
  console.log(`[subsidies] upsert: ${upserted}件`);

  // 4. 公募履歴を subsidy_schedules へ（schedule_key + acceptance_start で重複排除）
  const schedules = rows.map((r) => ({
    schedule_key: r.schedule_key,
    name: r.title,
    acceptance_start: r.acceptance_start_datetime,
    acceptance_end: r.acceptance_end_datetime,
    project_end_deadline: r.project_end_deadline,
    subsidy_id: r.id,
    source: "jgrants",
  }));
  let schedInserted = 0;
  for (const batch of chunk(schedules, 100)) {
    const { error } = await supabase.from("subsidy_schedules").upsert(batch, {
      onConflict: "schedule_key,acceptance_start",
      ignoreDuplicates: true,
    });
    if (error)
      throw new Error(`subsidy_schedules upsert 失敗: ${error.message}`);
    schedInserted += batch.length;
  }
  console.log(`[schedules] 履歴蓄積(重複は無視): ${schedInserted}件処理`);
  console.log("[done] 取込完了");
}

main().catch((err) => {
  console.error("[error]", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
