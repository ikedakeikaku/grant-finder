import "./load-env";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";
import {
  fromResearchRecord,
  toProgramRow,
  type RawProgram,
} from "../src/lib/catalog/programs";

/**
 * Claude Code(定額) が行った深掘り調査の結果を DB に書き戻すバッチ。
 * programs(発掘分) を upsert、proposals を保存、matches(kind=catalog) を作り直し、
 * 事業者を proposal_status='ready' にする。
 *
 * 使い方: pnpm tsx scripts/import-research.ts <results.json>
 *
 * results.json の形:
 * {
 *   "results": [
 *     {
 *       "businessId": "<uuid>",
 *       "summary": "提案の総括",
 *       "programs": [ { slug,name,level,prefecture,areaSearch,purpose,targetIndustries,
 *                       targetSize,subsidyRate,subsidyMax,keyRequirements,applicationFrames,
 *                       typicalSchedule,budgetBasis,officialUrl,scheduleKey,status,nextOpen,
 *                       confidence,isLargeAmount,isStartup,unifiedWith,sources,notes } ],
 *       "items": [ { programId, fitReason, eligibility, usability, prepare[], scheduleNote,
 *                    score, confidence, sources[], name, officialUrl, subsidyMax, subsidyRate,
 *                    areaSearch, level, status, nextOpen, isLargeAmount, isStartup } ]
 *     }
 *   ]
 * }
 */

type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

interface ResultItem {
  programId: string;
  score?: number;
  fitReason?: string;
  [k: string]: unknown;
}
interface BusinessResult {
  businessId: string;
  summary?: string;
  programs?: RawProgram[];
  items?: ResultItem[];
}

async function persist(
  admin: SupabaseAdmin,
  r: BusinessResult,
  now: Date,
): Promise<number> {
  // 1) 発掘した制度を programs へ upsert（source='discovered'）。
  const progRows = (r.programs ?? []).map((raw) => ({
    ...toProgramRow(fromResearchRecord(raw)),
    source: "discovered",
    researched_at: now.toISOString(),
  }));
  if (progRows.length > 0) {
    const { error } = await admin
      .from("programs")
      .upsert(progRows, { onConflict: "id" });
    if (error) throw new Error(`programs upsert 失敗: ${error.message}`);
  }

  // 2) 有効な program_id だけに絞る（存在しないIDはFK違反になるため）。
  const { data: allProgs, error: gErr } = await admin
    .from("programs")
    .select("id");
  if (gErr) throw new Error(`programs 取得失敗: ${gErr.message}`);
  const validIds = new Set((allProgs ?? []).map((p) => p.id as string));
  const items = (r.items ?? []).filter(
    (it) => typeof it.programId === "string" && validIds.has(it.programId),
  );

  // 3) proposals を upsert。
  const sources = [
    ...new Set(
      items.flatMap((it) =>
        Array.isArray(it.sources)
          ? (it.sources as unknown[]).filter(
              (x): x is string => typeof x === "string",
            )
          : [],
      ),
    ),
  ];
  const { error: pErr } = await admin.from("proposals").upsert(
    {
      business_id: r.businessId,
      summary: r.summary ?? "",
      items,
      model: "claude-code",
      research_sources: sources,
      status: "ready",
      generated_at: now.toISOString(),
    },
    { onConflict: "business_id" },
  );
  if (pErr) throw new Error(`proposals upsert 失敗: ${pErr.message}`);

  // 4) matches(kind=catalog) を作り直す。
  const rows = items.map((it) => ({
    business_id: r.businessId,
    kind: "catalog" as const,
    program_id: it.programId,
    score: typeof it.score === "number" ? it.score : 0.5,
    reasons: [typeof it.fitReason === "string" ? it.fitReason : ""].filter(
      Boolean,
    ),
  }));
  if (rows.length > 0) {
    const { error } = await admin
      .from("matches")
      .upsert(rows, { onConflict: "business_id,program_id" });
    if (error) throw new Error(`catalog matches upsert 失敗: ${error.message}`);
  }
  const keep = rows.map((x) => x.program_id);
  let del = admin
    .from("matches")
    .delete()
    .eq("business_id", r.businessId)
    .eq("kind", "catalog");
  if (keep.length > 0) del = del.not("program_id", "in", `(${keep.join(",")})`);
  const { error: delErr } = await del;
  if (delErr) throw new Error(`古い catalog matches 削除失敗: ${delErr.message}`);

  // 5) 事業者を ready に。
  const { error: bErr } = await admin
    .from("businesses")
    .update({
      proposal_status: "ready",
      proposal_refreshed_at: now.toISOString(),
    })
    .eq("id", r.businessId);
  if (bErr) throw new Error(`businesses 更新失敗: ${bErr.message}`);

  return rows.length;
}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error("使い方: pnpm tsx scripts/import-research.ts <results.json>");
    process.exitCode = 1;
    return;
  }
  const parsed = JSON.parse(readFileSync(resolve(process.cwd(), file), "utf8"));
  const results: BusinessResult[] = Array.isArray(parsed?.results)
    ? parsed.results
    : Array.isArray(parsed)
      ? parsed
      : [parsed];

  const now = new Date();
  const admin = createSupabaseAdminClient();
  let ok = 0;
  let total = 0;
  for (const r of results) {
    if (!r?.businessId) {
      console.error("[import-research] businessId 欠落のレコードをスキップ");
      continue;
    }
    try {
      total += await persist(admin, r, now);
      ok++;
    } catch (e) {
      console.error(
        `[import-research] business=${r.businessId} 失敗:`,
        e instanceof Error ? e.message : e,
      );
    }
  }
  console.log(`[import-research] ${ok}/${results.length}件 反映、提案 ${total}件`);
}

main().catch((err) => {
  console.error("[error]", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
