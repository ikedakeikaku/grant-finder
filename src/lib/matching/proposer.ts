import Anthropic from "@anthropic-ai/sdk";
import type { BusinessProfile } from "../core/matching";

/**
 * 提案エンジン（Claude Sonnet 4.6）。
 *
 * 旧 relevance ランカーの後継。短文の並べ替えではなく、制度マスタ(programs)の
 * 構造化された事実（補助率・上限・要件・スケジュール・予算動向）を読み、
 * 「この事業者が実際に使えるか」を判断して提案書（複数カード＋総括）を構造化出力する。
 *
 * - mode:'deep'  … 登録直後・月次。Web検索で最新の公募/予算/地元制度を補完。
 * - mode:'light' … 日次更新。Web無しの構造化推論のみ（安価）。
 *
 * ANTHROPIC_API_KEY 未設定なら無効（呼び出し側で決定論にフォールバック）。
 */

const MODEL = "claude-sonnet-4-6";

export interface ProposalCandidate {
  /** matches.program_id（`prog:<slug>`）。 */
  id: string;
  name: string;
  areaSearch: string;
  purpose: string;
  targetIndustries: string[];
  targetSize: string;
  subsidyRate: string | null;
  subsidyMax: number | null;
  keyRequirements: string[];
  applicationFrames: string[];
  typicalSchedule: string | null;
  budgetBasis: string | null;
  status: string;
  nextOpen: string | null;
  isLargeAmount: boolean;
  isStartup: boolean;
  officialUrl: string | null;
}

export interface ProposalItem {
  programId: string;
  /** なぜこの事業者に合うか。 */
  fitReason: string;
  /** 要件・対象に照らした「使える根拠」と満たすべき条件。 */
  eligibility: string;
  /** 率直な使用可能性の評価（要確認点を含む）。 */
  usability: string;
  /** 準備物・次アクション。 */
  prepare: string[];
  /** 公募時期/締切 or 予測ウィンドウの案内。 */
  scheduleNote: string;
  /** おすすめ度 0..1。 */
  score: number;
  /** 情報の確度 0..1。 */
  confidence: number;
  sources: string[];
}

export interface ProposalResult {
  summary: string;
  items: ProposalItem[];
}

export interface BuildProposalOptions {
  mode: "deep" | "light";
  /** 提案件数の上限（既定10）。 */
  max?: number;
}

export type ProposerProfile = BusinessProfile & {
  description?: string | null;
  plannedInvestment?: string | null;
  annualRevenue?: number | null;
  foundedYear?: number | null;
};

export function isProposerEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

function profileText(p: ProposerProfile): string {
  const lines = [
    `業種: ${p.industry ?? "不明"}`,
    `所在地: ${p.prefecture ?? "不明"}${p.city ? " " + p.city : ""}`,
    `従業員数: ${p.employeeCount ?? "不明"}`,
    `年商(万円): ${p.annualRevenue ?? "不明"}`,
    `設立年: ${p.foundedYear ?? "不明"}`,
    `目的: ${p.purposes.length ? p.purposes.join("、") : "未設定"}`,
    `関心: ${p.interests.length ? p.interests.join("、") : "未設定"}`,
  ];
  if (p.description) lines.push(`事業内容: ${p.description}`);
  if (p.plannedInvestment) lines.push(`検討中の投資: ${p.plannedInvestment}`);
  return lines.join("\n");
}

const SYSTEM = `あなたは日本の中小企業向け補助金の専門アドバイザーです。
ある事業者のプロフィールと、構造化された補助金制度カタログを渡します。
この事業者が「実際に申請を検討する価値があり、要件的にも使える」制度だけを厳選し、おすすめ順に提案書を作成してください。

重要な方針:
- 件数を埋めるための水増しをしない。本当に関連し使えるものだけを selected する（最大件数に満たなくてよい）。
- 各制度について、補助率・上限・主要要件（賃上げ/GビズID/認定支援機関/賃金台帳/事業計画 等）に照らし、
  この事業者が満たせそうか・何を準備すべきかを率直に書く（eligibility / usability）。
- 公募が現在ありなら締切感、公募前なら「例年そろそろ／予算がつき今年も実施見込み」という予告として scheduleNote に書く。
- 事実は渡されたカタログを根拠にする。Web検索ツールが使える場合のみ、最新の公募時期・予算・地元自治体制度を補強してよい（出典URLを sources に入れる）。
- 推測で数値を断定しない。不確実な点は usability に明記し confidence を下げる。
- reason 類は日本語で簡潔に。

必ず submit_proposal ツールで結果（summary と items）を返してください。`;

const SUBMIT_TOOL = {
  name: "submit_proposal",
  description: "事業者向けの補助金提案書（総括と提案カード）を返す",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: { type: "string", description: "提案全体の総括（2〜3文・日本語）" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            programId: { type: "string", description: "カタログ候補の id をそのまま" },
            fitReason: { type: "string", description: "この事業者に合う理由" },
            eligibility: {
              type: "string",
              description: "要件・対象に照らした使える根拠と満たすべき条件",
            },
            usability: {
              type: "string",
              description: "率直な使用可能性の評価（要確認点を含む）",
            },
            prepare: {
              type: "array",
              items: { type: "string" },
              description: "準備物・次アクション",
            },
            scheduleNote: {
              type: "string",
              description: "公募時期/締切 or 公募前予告の案内",
            },
            score: { type: "number", description: "おすすめ度 0..1" },
            confidence: { type: "number", description: "情報の確度 0..1" },
            sources: { type: "array", items: { type: "string" } },
          },
          required: [
            "programId",
            "fitReason",
            "eligibility",
            "usability",
            "prepare",
            "scheduleNote",
            "score",
            "confidence",
            "sources",
          ],
        },
      },
    },
    required: ["summary", "items"],
  },
};

/** server-tool(web_search) のサーバー側ループ上限に達した場合の継続回数。 */
const MAX_CONTINUATIONS = 6;

/**
 * 候補をLLMに渡し、提案書（総括＋カード）を構造化出力させる。
 * 失敗時は例外を投げる（呼び出し側で決定論にフォールバック）。
 */
export async function buildProposal(
  profile: ProposerProfile,
  candidates: ProposalCandidate[],
  options: BuildProposalOptions,
): Promise<ProposalResult> {
  if (candidates.length === 0) return { summary: "", items: [] };
  const max = options.max ?? 10;
  const client = new Anthropic();

  const userContent = [
    "## 事業者プロフィール",
    profileText(profile),
    "",
    `## 補助金制度カタログ（候補・JSON）`,
    JSON.stringify(candidates),
    "",
    `上記から、この事業者が実際に使える制度を最大${max}件、おすすめ順に厳選し、submit_proposal で提案書を返してください。`,
  ].join("\n");

  // deep モードのみ Web 検索を許可。submit_proposal は常に提供（クライアント側で読むだけ）。
  const webSearch: Anthropic.Messages.WebSearchTool20260209 = {
    type: "web_search_20260209",
    name: "web_search",
  };
  const tools =
    options.mode === "deep" ? [webSearch, SUBMIT_TOOL] : [SUBMIT_TOOL];

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userContent },
  ];

  for (let i = 0; i < MAX_CONTINUATIONS; i++) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      temperature: 0,
      system: SYSTEM,
      // light モードは submit を強制（1往復）。deep は検索→submit を自走させる。
      tool_choice:
        options.mode === "light"
          ? { type: "tool", name: "submit_proposal" }
          : { type: "auto" },
      tools,
      messages,
    });

    const submit = res.content.find(
      (b) => b.type === "tool_use" && b.name === "submit_proposal",
    );
    if (submit && submit.type === "tool_use") {
      return normalizeProposal(submit.input, candidates, max);
    }

    // server-tool(web_search) がサーバー側ループ上限に達した → 継続。
    if (res.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: res.content });
      continue;
    }
    // それ以外（end_turn 等）で submit が無ければ打ち切り。
    break;
  }

  throw new Error("proposer: submit_proposal 応答が得られませんでした");
}

function clamp01(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

/** LLM出力を検証・整形する。候補に無い programId は捨てる（純粋関数・テスト可能）。 */
export function normalizeProposal(
  input: unknown,
  candidates: Array<{ id: string }>,
  max: number,
): ProposalResult {
  const valid = new Set(candidates.map((c) => c.id));
  const obj = (input ?? {}) as {
    summary?: unknown;
    items?: unknown;
  };
  const rawItems = Array.isArray(obj.items) ? obj.items : [];
  const seen = new Set<string>();
  const items: ProposalItem[] = [];
  for (const r of rawItems) {
    const it = r as Record<string, unknown>;
    const programId = typeof it.programId === "string" ? it.programId : "";
    if (!valid.has(programId) || seen.has(programId)) continue;
    seen.add(programId);
    items.push({
      programId,
      fitReason: typeof it.fitReason === "string" ? it.fitReason : "",
      eligibility: typeof it.eligibility === "string" ? it.eligibility : "",
      usability: typeof it.usability === "string" ? it.usability : "",
      prepare: asStringArray(it.prepare),
      scheduleNote: typeof it.scheduleNote === "string" ? it.scheduleNote : "",
      score: clamp01(it.score),
      confidence: clamp01(it.confidence),
      sources: asStringArray(it.sources),
    });
  }
  items.sort((a, b) => b.score - a.score);
  return {
    summary: typeof obj.summary === "string" ? obj.summary : "",
    items: items.slice(0, max),
  };
}
