import "./load-env";
import { differenceInCalendarDays } from "date-fns";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";
import {
  isProgramInArea,
  fromResearchRecord,
  toProgramRow,
  type ProgramLevel,
} from "../src/lib/catalog/programs";
import {
  buildProposal,
  isProposerEnabled,
  type ProposalCandidate,
  type ProposerProfile,
} from "../src/lib/matching/proposer";
import {
  discoverPrograms,
  isDiscoveryEnabled,
} from "../src/lib/catalog/discover";
import { safeHttpUrl } from "../src/lib/url";

/**
 * 提案書生成バッチ。提案エンジン(proposer)で事業者ごとに「使える根拠つき」の
 * 補助金提案書を作り、proposals に保存し、matches(kind=catalog) を作り直す。
 * 既存の通知エンジン(60/30/14/7・pre_announce・proposal_digest) はこの matches を起点に動く。
 *
 *  - 新規/プロフィール変更(proposal_status='pending') → deep(Web調査込み)
 *  - 30日以上前の再生成 → light(構造化推論のみ)
 *  - 引数 --all で全事業者を強制再生成
 */

type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

/** 提案で扱う上限件数。 */
const MAX_ITEMS = 10;
/** LLM に渡す候補の上限。 */
const CANDIDATE_POOL = 80;
/** 再生成の鮮度（日）。 */
const STALE_DAYS = 30;

interface BusinessRow {
  id: string;
  industry: string | null;
  prefecture: string | null;
  city: string | null;
  employee_count: number | null;
  annual_revenue: number | null;
  founded_year: number | null;
  purposes: string[] | null;
  interests: string[] | null;
  description: string | null;
  planned_investment: string | null;
  proposal_status: string | null;
  proposal_refreshed_at: string | null;
}

interface ProgramRow {
  id: string;
  name: string;
  level: string;
  prefecture: string | null;
  area_search: string | null;
  purpose: string | null;
  target_industries: string[] | null;
  target_size: string | null;
  subsidy_rate: string | null;
  subsidy_max: number | null;
  key_requirements: string[] | null;
  application_frames: string[] | null;
  typical_schedule: string | null;
  budget_basis: string | null;
  official_url: string | null;
  status: string;
  next_open_from: string | null;
  is_large_amount: boolean;
  is_startup: boolean;
}

async function fetchPrograms(admin: SupabaseAdmin): Promise<ProgramRow[]> {
  const { data, error } = await admin
    .from("programs")
    .select(
      "id, name, level, prefecture, area_search, purpose, target_industries, target_size, subsidy_rate, subsidy_max, key_requirements, application_frames, typical_schedule, budget_basis, official_url, status, next_open_from, is_large_amount, is_startup",
    )
    .in("status", ["active", "watch"]);
  if (error) throw new Error(`programs 取得失敗: ${error.message}`);
  return (data ?? []) as ProgramRow[];
}

function toCandidate(p: ProgramRow): ProposalCandidate {
  return {
    id: p.id,
    name: p.name,
    areaSearch: p.area_search ?? "全国",
    purpose: p.purpose ?? "",
    targetIndustries: p.target_industries ?? [],
    targetSize: p.target_size ?? "",
    subsidyRate: p.subsidy_rate,
    subsidyMax: p.subsidy_max,
    keyRequirements: p.key_requirements ?? [],
    applicationFrames: p.application_frames ?? [],
    typicalSchedule: p.typical_schedule,
    budgetBasis: p.budget_basis,
    status: p.status,
    nextOpen: p.next_open_from,
    isLargeAmount: p.is_large_amount,
    isStartup: p.is_startup,
    officialUrl: safeHttpUrl(p.official_url),
  };
}

function candidateScore(b: BusinessRow, p: ProgramRow): number {
  const haystack = [
    p.name,
    p.purpose,
    p.target_size,
    p.budget_basis,
    ...(p.target_industries ?? []),
    ...(p.key_requirements ?? []),
    ...(p.application_frames ?? []),
  ]
    .filter(Boolean)
    .join(" ");

  let score = 0;
  for (const purpose of b.purposes ?? []) {
    if (purpose && haystack.includes(purpose)) score += 3;
  }
  for (const interest of b.interests ?? []) {
    if (interest.length >= 2 && haystack.includes(interest)) score += 2;
  }
  if (b.industry && haystack.includes(b.industry)) score += 2;
  if (p.is_large_amount) score += 0.5;
  if (
    p.is_startup &&
    b.founded_year &&
    new Date().getFullYear() - b.founded_year <= 5
  ) {
    score += 1;
  }
  return score;
}

/** 関心駆動の制度発掘（deepのみ）。未収録の制度をWeb調査→programsへ永続化し、ProgramRow[]で返す。 */
async function discoverForBusiness(
  admin: SupabaseAdmin,
  profile: ProposerProfile,
  existing: ProgramRow[],
  now: Date,
): Promise<ProgramRow[]> {
  if (!isDiscoveryEnabled()) return [];
  const names = existing.map((p) => p.name);
  const slugs = existing.map((p) => p.id.replace(/^prog:/, ""));
  let discovered: Awaited<ReturnType<typeof discoverPrograms>> = [];
  try {
    discovered = await discoverPrograms(profile, names, slugs, { max: 6 });
  } catch (e) {
    console.error(
      "[build-proposals] 発掘に失敗(スキップ):",
      e instanceof Error ? e.message : e,
    );
    return [];
  }
  if (discovered.length === 0) return [];

  const rows = discovered.map((raw) => ({
    ...toProgramRow(fromResearchRecord(raw)),
    source: "discovered",
    researched_at: now.toISOString(),
  }));
  const { error } = await admin
    .from("programs")
    .upsert(rows, { onConflict: "id" });
  if (error) {
    console.error("[build-proposals] 発掘制度の保存に失敗:", error.message);
    return [];
  }
  console.log(
    `[build-proposals] 発掘: ${rows.length}件をカタログに追加（${discovered.map((d) => d.name).join(" / ")}）`,
  );
  return rows as unknown as ProgramRow[];
}

function decideMode(b: BusinessRow, now: Date): "deep" | "light" | "skip" {
  if (b.proposal_status === "pending" || !b.proposal_refreshed_at)
    return "deep";
  const age = differenceInCalendarDays(now, new Date(b.proposal_refreshed_at));
  return age >= STALE_DAYS ? "light" : "skip";
}

async function processBusiness(
  admin: SupabaseAdmin,
  b: BusinessRow,
  programs: ProgramRow[],
  mode: "deep" | "light",
  now: Date,
): Promise<number> {
  const profile: ProposerProfile = {
    industry: b.industry,
    prefecture: b.prefecture,
    city: b.city,
    employeeCount: b.employee_count,
    annualRevenue: b.annual_revenue,
    foundedYear: b.founded_year,
    purposes: b.purposes ?? [],
    interests: b.interests ?? [],
    description: b.description,
    plannedInvestment: b.planned_investment,
  };

  // deep のみ：関心駆動で未収録の制度を発掘してカタログに追加し、候補に含める。
  let allPrograms = programs;
  if (mode === "deep") {
    const discovered = await discoverForBusiness(admin, profile, programs, now);
    if (discovered.length > 0) allPrograms = [...programs, ...discovered];
  }

  // 所在地で粗くフィルタ（国＋自県＋全国）。
  const inArea = allPrograms.filter((p) =>
    isProgramInArea(
      {
        areaSearch: p.area_search ?? "",
        level: p.level as ProgramLevel,
        prefecture: p.prefecture,
      },
      b.prefecture,
      b.city,
    ),
  );
  const pool = inArea
    .map((p) => ({ p, score: candidateScore(b, p) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.p.is_large_amount) - Number(a.p.is_large_amount),
    )
    .slice(0, CANDIDATE_POOL)
    .map((x) => x.p);
  const byId = new Map(pool.map((p) => [p.id, p]));
  const candidates = pool.map(toCandidate);

  const result = await buildProposal(profile, candidates, {
    mode,
    max: MAX_ITEMS,
  });

  // 提案カードを表示用に program の事実で肉付けして保存。
  const items = result.items.map((it) => {
    const p = byId.get(it.programId);
    return {
      ...it,
      name: p?.name ?? "",
      officialUrl: p?.official_url ?? null,
      subsidyMax: p?.subsidy_max ?? null,
      subsidyRate: p?.subsidy_rate ?? null,
      areaSearch: p?.area_search ?? null,
      level: p?.level ?? null,
      status: p?.status ?? null,
      nextOpen: p?.next_open_from ?? null,
      isLargeAmount: p?.is_large_amount ?? false,
      isStartup: p?.is_startup ?? false,
    };
  });
  const researchSources = [...new Set(items.flatMap((i) => i.sources))];

  // proposals を upsert（最新1件）。
  const { error: pErr } = await admin.from("proposals").upsert(
    {
      business_id: b.id,
      summary: result.summary,
      items,
      model: "claude-sonnet-4-6",
      research_sources: researchSources,
      status: "ready",
      generated_at: now.toISOString(),
    },
    { onConflict: "business_id" },
  );
  if (pErr) throw new Error(`proposals upsert 失敗: ${pErr.message}`);

  // matches(kind=catalog) を作り直す。
  const rows = result.items.map((it) => ({
    business_id: b.id,
    kind: "catalog" as const,
    program_id: it.programId,
    score: it.score,
    reasons: [it.fitReason].filter(Boolean),
  }));
  if (rows.length > 0) {
    const { error } = await admin
      .from("matches")
      .upsert(rows, { onConflict: "business_id,program_id" });
    if (error) throw new Error(`catalog matches upsert 失敗: ${error.message}`);
  }
  // 今回含まれない catalog マッチを削除。
  const keep = rows.map((r) => r.program_id);
  let del = admin
    .from("matches")
    .delete()
    .eq("business_id", b.id)
    .eq("kind", "catalog");
  if (keep.length > 0) {
    del = del.not("program_id", "in", `(${keep.join(",")})`);
  }
  const { error: delErr } = await del;
  if (delErr)
    throw new Error(`古い catalog matches 削除失敗: ${delErr.message}`);

  // 状態を ready に。
  const { error: bErr } = await admin
    .from("businesses")
    .update({
      proposal_status: "ready",
      proposal_refreshed_at: now.toISOString(),
    })
    .eq("id", b.id);
  if (bErr) throw new Error(`businesses 更新失敗: ${bErr.message}`);

  return rows.length;
}

async function main(): Promise<void> {
  const now = new Date();
  const force = process.argv.includes("--all");
  const admin = createSupabaseAdminClient();

  if (!isProposerEnabled()) {
    console.log(
      "[build-proposals] ANTHROPIC_API_KEY 未設定のためスキップ（提案は生成されません）",
    );
    return;
  }

  const programs = await fetchPrograms(admin);
  if (programs.length === 0) {
    console.log(
      "[build-proposals] programs が空です。先に seed:programs を実行してください",
    );
    return;
  }

  const { data, error } = await admin
    .from("businesses")
    .select(
      "id, industry, prefecture, city, employee_count, annual_revenue, founded_year, purposes, interests, description, planned_investment, proposal_status, proposal_refreshed_at",
    );
  if (error) throw new Error(`businesses 取得失敗: ${error.message}`);
  const businesses = (data ?? []) as BusinessRow[];

  let processed = 0;
  let items = 0;
  for (const b of businesses) {
    const mode = force ? "deep" : decideMode(b, now);
    if (mode === "skip") continue;
    try {
      items += await processBusiness(admin, b, programs, mode, now);
      processed++;
    } catch (e) {
      console.error(
        `[build-proposals] business=${b.id} 失敗:`,
        e instanceof Error ? e.message : e,
      );
      await admin
        .from("businesses")
        .update({ proposal_status: "error" })
        .eq("id", b.id);
    }
  }

  console.log(
    `[build-proposals] 事業者 ${processed}/${businesses.length} 件を処理、提案 ${items} 件`,
  );
}

main().catch((err) => {
  console.error("[error]", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
