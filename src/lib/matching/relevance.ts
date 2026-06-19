import Anthropic from "@anthropic-ai/sdk";
import type { BusinessProfile } from "../core/matching";

/**
 * LLM(Claude Haiku 4.5)による関連性ランカー。
 *
 * 決定論マッチングは「全国・全業種・汎用目的」の補助金を区別できない
 * （原子力もIT導入も同じメタデータに見える）。タイトル・概要を意味的に読み、
 * この事業者にとっての関連性を判定して上位だけ厳選するために使う。
 *
 * ANTHROPIC_API_KEY が未設定なら無効（呼び出し側で決定論にフォールバック）。
 */

const MODEL = "claude-haiku-4-5";

export interface RelevanceCandidate {
  id: string;
  title: string;
  catchPhrase: string | null;
  usePurpose: string | null;
}

export interface RelevanceResult {
  id: string;
  relevance: number; // 0..1
  reason: string;
}

export function isRelevanceEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

function profileText(
  p: BusinessProfile & {
    description?: string | null;
    plannedInvestment?: string | null;
  },
): string {
  const lines = [
    `業種: ${p.industry ?? "不明"}`,
    `所在地: ${p.prefecture ?? "不明"}`,
    `従業員数: ${p.employeeCount ?? "不明"}`,
    `目的: ${p.purposes.length ? p.purposes.join("、") : "未設定"}`,
    `関心: ${p.interests.length ? p.interests.join("、") : "未設定"}`,
  ];
  if (p.description) lines.push(`事業内容: ${p.description}`);
  if (p.plannedInvestment) lines.push(`検討中の投資: ${p.plannedInvestment}`);
  return lines.join("\n");
}

const SYSTEM = `あなたは日本の中小企業向け補助金の専門アドバイザーです。
ある事業者のプロフィールに対し、各補助金が「この事業者が実際に申請を検討する価値があるか（事業内容との実質的な関連性）」を 0〜1 で評価します。

判定の指針:
- 事業内容と無関係な特定業界専用の補助金（例: 原子力、PCB処理、特定の重工業設備、その事業者がやらない分野）は 0.2 未満。
- 多くの中小企業に広く使える汎用的な補助金（ものづくり、IT導入、省力化、販路開拓、持続化、事業承継 等）で、この事業者の業種・目的に合うものは高く。
- 「全国・全業種対象」というだけで形式的に一致していても、事業内容と関連が薄ければ低くする。
必ず submit_relevance ツールで全候補の結果を返してください。reason は日本語40字以内。`;

const TOOL: Anthropic.Tool = {
  name: "submit_relevance",
  description: "各補助金候補の関連性評価を返す",
  input_schema: {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            relevance: { type: "number", description: "0〜1" },
            reason: { type: "string", description: "日本語40字以内" },
          },
          required: ["id", "relevance", "reason"],
        },
      },
    },
    required: ["results"],
  },
};

/**
 * 候補を一括でLLMに採点させ、関連性スコアと理由を返す。
 * 失敗時は例外を投げる（呼び出し側で決定論にフォールバックする）。
 */
export async function rankRelevance(
  profile: BusinessProfile & {
    description?: string | null;
    plannedInvestment?: string | null;
  },
  candidates: RelevanceCandidate[],
): Promise<RelevanceResult[]> {
  if (candidates.length === 0) return [];
  const client = new Anthropic();

  const userContent = [
    "## 事業者プロフィール",
    profileText(profile),
    "",
    "## 補助金候補(JSON)",
    JSON.stringify(
      candidates.map((c) => ({
        id: c.id,
        title: c.title,
        catch: c.catchPhrase,
        purpose: c.usePurpose,
      })),
    ),
    "",
    "全候補について relevance(0〜1) と reason を submit_relevance で返してください。",
  ].join("\n");

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "submit_relevance" },
    messages: [{ role: "user", content: userContent }],
  });

  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error("relevance: tool_use 応答がありません");
  }
  const input = block.input as { results?: RelevanceResult[] };
  return input.results ?? [];
}
