import "./load-env";
import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";

/**
 * 制度マスタの予算動向・公募日程をWeb調査で更新するバッチ（低頻度・週次/手動）。
 * 各 program について Claude(Sonnet 4.6)＋Web検索で、令和8年度(FY2026)の
 * 予算状況・例年スケジュール・次回公募見込み・公式URLを裏取りし、
 * programs を更新し budget_signals を投入する。これが「公募前予告」の精度の核。
 *
 * 使い方: pnpm research:catalog [--limit N] [--all]
 *   既定は researched_at が古い/未調査の制度を最大 N(=8) 件。
 */

const MODEL = "claude-sonnet-4-6";
const DEFAULT_LIMIT = 8;
const REFRESH_DAYS = 7;
const MAX_CONTINUATIONS = 6;

interface ProgramRow {
  id: string;
  name: string;
  schedule_key: string | null;
  official_url: string | null;
  prefecture: string | null;
  researched_at: string | null;
}

interface ResearchResult {
  budgetBasis: string;
  typicalSchedule: string;
  nextOpenFrom: string | null;
  nextOpenTo: string | null;
  status: string;
  confidence: number;
  officialUrl: string;
  sources: string[];
  /** 予算シグナル種別: gaisan_youkyuu | hosei | tousho | none */
  signalKind: string;
  signalNote: string;
}

const SUBMIT_TOOL = {
  name: "submit_research",
  description: "制度の予算動向・公募日程の調査結果を返す",
  input_schema: {
    type: "object" as const,
    properties: {
      budgetBasis: {
        type: "string",
        description: "令和8年度の予算状況（概算要求/補正/当初/実施有無）を簡潔に",
      },
      typicalSchedule: { type: "string", description: "例年の公募開始・締切の傾向" },
      nextOpenFrom: {
        type: "string",
        description: "次回公募開始見込み(YYYY-MM-DD)。不明は空文字",
      },
      nextOpenTo: { type: "string", description: "公募開始ウィンドウ終端(YYYY-MM-DD)。不明は空文字" },
      status: { type: "string", description: "active(実施確実/公募中) | watch(実施見込み) | ended" },
      confidence: { type: "number", description: "確度 0..1" },
      officialUrl: { type: "string", description: "公式サイトURL" },
      sources: { type: "array", items: { type: "string" }, description: "出典URL" },
      signalKind: {
        type: "string",
        description: "予算シグナル: gaisan_youkyuu | hosei | tousho | none",
      },
      signalNote: { type: "string", description: "予算シグナルの要点（無ければ空）" },
    },
    required: [
      "budgetBasis",
      "typicalSchedule",
      "nextOpenFrom",
      "nextOpenTo",
      "status",
      "confidence",
      "officialUrl",
      "sources",
      "signalKind",
      "signalNote",
    ],
  },
};

const SYSTEM = `あなたは日本の補助金の予算・公募スケジュールを追う専門リサーチャーです。現在は2026-06-20（令和8年度/FY2026）。
Web検索(web_search)で公式情報（中小企業庁/経産省/各自治体/SII/jGrants/各事務局）を必ず裏取りし、
対象制度の「令和8年度の予算状況」「例年の公募スケジュール」「次回公募の見込み時期」「公式URL」を確認してください。
- 推測で数値・日付を断定しない。確認できなければ空文字にし confidence を下げる。
- 概算要求/補正予算/当初予算成立 のいずれかの動きがあれば signalKind に分類する。
- 必ず submit_research で返す。出典URLを sources に入れる。`;

async function research(
  client: Anthropic,
  p: ProgramRow,
): Promise<ResearchResult | null> {
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: [
        `対象制度: ${p.name}`,
        p.prefecture ? `自治体: ${p.prefecture}` : "区分: 国の制度",
        p.official_url ? `参考URL: ${p.official_url}` : "",
        "",
        "この制度の令和8年度の予算動向・公募スケジュール・次回見込みを調べ、submit_research で返してください。",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  const webSearch: Anthropic.Messages.WebSearchTool20260209 = {
    type: "web_search_20260209",
    name: "web_search",
  };
  for (let i = 0; i < MAX_CONTINUATIONS; i++) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      temperature: 0,
      system: SYSTEM,
      tool_choice: { type: "auto" },
      tools: [webSearch, SUBMIT_TOOL],
      messages,
    });
    const submit = res.content.find(
      (b) => b.type === "tool_use" && b.name === "submit_research",
    );
    if (submit && submit.type === "tool_use") {
      return normalizeResearch(submit.input);
    }
    if (res.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: res.content });
      continue;
    }
    break;
  }
  return null;
}

function normalizeResearch(input: unknown): ResearchResult {
  const o = (input ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
  const arr = (k: string) =>
    Array.isArray(o[k])
      ? (o[k] as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
  const conf =
    typeof o.confidence === "number" ? Math.max(0, Math.min(1, o.confidence)) : 0;
  return {
    budgetBasis: str("budgetBasis"),
    typicalSchedule: str("typicalSchedule"),
    nextOpenFrom: str("nextOpenFrom") || null,
    nextOpenTo: str("nextOpenTo") || null,
    status: str("status") || "watch",
    confidence: conf,
    officialUrl: str("officialUrl"),
    sources: arr("sources"),
    signalKind: str("signalKind") || "none",
    signalNote: str("signalNote"),
  };
}

const VALID_SIGNAL = new Set(["gaisan_youkyuu", "hosei", "tousho"]);

function toIso(d: string | null): string | null {
  if (!d) return null;
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("[research-catalog] ANTHROPIC_API_KEY 未設定のためスキップ");
    return;
  }
  const now = new Date();
  const all = process.argv.includes("--all");
  const limArg = process.argv.indexOf("--limit");
  const limit =
    limArg >= 0 && process.argv[limArg + 1]
      ? Number(process.argv[limArg + 1])
      : DEFAULT_LIMIT;

  const admin = createSupabaseAdminClient();
  const client = new Anthropic();

  const { data, error } = await admin
    .from("programs")
    .select("id, name, schedule_key, official_url, prefecture, researched_at")
    .order("researched_at", { ascending: true, nullsFirst: true });
  if (error) throw new Error(`programs 取得失敗: ${error.message}`);

  const cutoff = new Date(now.getTime() - REFRESH_DAYS * 86400_000);
  const targets = (data ?? [])
    .filter((p: ProgramRow) => {
      if (all) return true;
      if (!p.researched_at) return true;
      return new Date(p.researched_at) < cutoff;
    })
    .slice(0, limit) as ProgramRow[];

  let updated = 0;
  let signals = 0;
  for (const p of targets) {
    try {
      const r = await research(client, p);
      if (!r) {
        console.warn(`[research-catalog] ${p.name}: 結果なし`);
        continue;
      }
      const patch: Record<string, unknown> = {
        budget_basis: r.budgetBasis || null,
        typical_schedule: r.typicalSchedule || null,
        next_open_from: toIso(r.nextOpenFrom),
        next_open_to: toIso(r.nextOpenTo),
        status: ["active", "watch", "ended"].includes(r.status)
          ? r.status
          : "watch",
        confidence: r.confidence,
        sources: r.sources,
        source: "research",
        researched_at: now.toISOString(),
      };
      if (r.officialUrl) patch.official_url = r.officialUrl;

      const { error: uErr } = await admin
        .from("programs")
        .update(patch)
        .eq("id", p.id);
      if (uErr) throw new Error(uErr.message);
      updated++;

      if (VALID_SIGNAL.has(r.signalKind)) {
        const { error: sErr } = await admin.from("budget_signals").insert({
          program_id: p.id,
          schedule_key: p.schedule_key,
          program_name: p.name,
          kind: r.signalKind,
          source_url: r.sources[0] ?? null,
          note: r.signalNote || null,
          status: "new",
        });
        if (!sErr) signals++;
      }
      console.log(`[research-catalog] ${p.name}: 更新 (status=${patch.status})`);
    } catch (e) {
      console.error(
        `[research-catalog] ${p.name}: 失敗`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  console.log(
    `[research-catalog] ${updated}件更新 / 予算シグナル ${signals}件 (対象${targets.length})`,
  );
}

main().catch((err) => {
  console.error("[error]", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
