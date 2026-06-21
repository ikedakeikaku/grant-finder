import Anthropic from "@anthropic-ai/sdk";
import type { BusinessProfile } from "../core/matching";
import type { RawProgram } from "./programs";

/**
 * 関心駆動の制度発掘（Claude Sonnet 4.6 ＋ Web検索）。
 *
 * 「カタログにある制度しか提案しない」を超えるための仕組み。登録者の関心領域
 * （観光・雇用/人材・脱炭素 等）が既存カタログで手薄なとき、その場でWeb調査して
 * 実在する制度を発掘し、RawProgram として返す。呼び出し側が programs に永続化すれば、
 * 以後は提案・公募前予告の対象になり、他の事業者にも活きる（カタログが需要から育つ）。
 *
 * - 既存カタログ名を渡して重複を避ける。
 * - 観光なら観光庁/自治体観光、雇用・人材なら厚労省の助成金も対象に含める。
 * - 推測で数値・日付を断定させない。実在確認できたものだけ。出典URL必須。
 */

const MODEL = "claude-sonnet-4-6";
const MAX_CONTINUATIONS = 6;

export type DiscoverProfile = BusinessProfile & {
  description?: string | null;
  plannedInvestment?: string | null;
};

export function isDiscoveryEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

function profileText(p: DiscoverProfile): string {
  const lines = [
    `業種: ${p.industry ?? "不明"}`,
    `所在地: ${p.prefecture ?? "不明"}${p.city ? " " + p.city : ""}`,
    `従業員数: ${p.employeeCount ?? "不明"}`,
    `目的: ${p.purposes.length ? p.purposes.join("、") : "未設定"}`,
    `関心: ${p.interests.length ? p.interests.join("、") : "未設定"}`,
  ];
  if (p.description) lines.push(`事業内容: ${p.description}`);
  if (p.plannedInvestment) lines.push(`検討中の投資: ${p.plannedInvestment}`);
  return lines.join("\n");
}

const SUBMIT_TOOL = {
  name: "submit_programs",
  description: "発掘した補助金・助成金制度を構造化して返す",
  input_schema: {
    type: "object" as const,
    properties: {
      programs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            slug: {
              type: "string",
              description: "英小文字/ハイフンの安定識別子(既存と重複しない)",
            },
            name: { type: "string" },
            level: {
              type: "string",
              description: "national | prefecture | municipal",
            },
            prefecture: {
              type: "string",
              description: "自治体制度の都道府県。国は空文字",
            },
            areaSearch: { type: "string", description: "全国 / 東京都 等" },
            purpose: { type: "string" },
            targetIndustries: { type: "array", items: { type: "string" } },
            targetSize: { type: "string" },
            subsidyRate: { type: "string" },
            subsidyMax: { type: "string", description: "円(数字)。不明は空" },
            keyRequirements: { type: "array", items: { type: "string" } },
            applicationFrames: { type: "array", items: { type: "string" } },
            typicalSchedule: { type: "string" },
            budgetBasis: { type: "string" },
            officialUrl: { type: "string" },
            scheduleKey: { type: "string" },
            status: { type: "string", description: "active | watch | ended" },
            nextOpen: { type: "string", description: "YYYY-MM 等。不明は空" },
            confidence: { type: "number" },
            isLargeAmount: { type: "boolean" },
            isStartup: { type: "boolean" },
            unifiedWith: { type: "string" },
            sources: { type: "array", items: { type: "string" } },
            notes: { type: "string" },
          },
          required: [
            "slug",
            "name",
            "level",
            "prefecture",
            "areaSearch",
            "purpose",
            "targetIndustries",
            "targetSize",
            "subsidyRate",
            "subsidyMax",
            "keyRequirements",
            "applicationFrames",
            "typicalSchedule",
            "budgetBasis",
            "officialUrl",
            "scheduleKey",
            "status",
            "nextOpen",
            "confidence",
            "isLargeAmount",
            "isStartup",
            "unifiedWith",
            "sources",
            "notes",
          ],
        },
      },
    },
    required: ["programs"],
  },
};

const SYSTEM = `あなたは日本の補助金・助成金の専門リサーチャーです。現在は2026年（令和8年度/FY2026）。
ある事業者の関心領域に合致する制度のうち、提示する「既存カタログ」に無いものを、Web検索(web_search)で実在確認して追加収集します。

方針:
- 事業者の関心・目的・業種・所在地に直接関係する制度に絞る。観光なら観光庁/自治体の観光振興、雇用・人材なら厚生労働省の助成金（雇用調整助成金/キャリアアップ助成金/人材開発支援助成金/特定求職者雇用開発助成金/トライアル雇用助成金/業務改善助成金 等）、脱炭素なら環境省/経産省 等も対象に含める（補助金だけでなく助成金も可）。
- **事業者の所在地（市区町村）の地元制度を必ず重点的に調べる**。市区町村・都道府県の中小企業向け補助金（創業/起業、店舗・設備投資、販路開拓・展示会、空き店舗・出店、ホームページ・DX、省エネ、事業承継 等）を、その市区町村の産業振興課・商工会議所/商工会・公社の公式情報で確認する。地元の市区町村制度は競争が緩く採択されやすいので、該当があれば level=municipal で漏れなく拾う。
- 既存カタログに既にあるものは返さない（slug・名称の重複禁止）。
- 必ず公式情報(各省庁/自治体/事務局)で裏取りし、補助率・上限・主要要件・例年スケジュール・公式URL・出典を埋める。
- 推測で数値・日付を断定しない。確認できない項目は空文字にし confidence を下げる。実在が確認できない制度は返さない。
- 該当が無ければ programs を空配列で返す。水増し禁止。
必ず submit_programs で返してください。`;

function clampConf(n: unknown): number {
  return typeof n === "number" ? Math.max(0, Math.min(1, n)) : 0;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function strArr(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

/** LLM出力を RawProgram[] に整形（既存と重複するものは除外）。 */
function normalize(
  input: unknown,
  existingSlugs: Set<string>,
  existingNames: Set<string>,
  max: number,
): RawProgram[] {
  const obj = (input ?? {}) as { programs?: unknown };
  const raw = Array.isArray(obj.programs) ? obj.programs : [];
  const out: RawProgram[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const o = r as Record<string, unknown>;
    const slug = str(o.slug).trim();
    const name = str(o.name).trim();
    if (!slug || !name) continue;
    if (existingSlugs.has(slug) || existingNames.has(name) || seen.has(slug))
      continue;
    seen.add(slug);
    out.push({
      slug,
      name,
      level: str(o.level) || "national",
      prefecture: str(o.prefecture),
      areaSearch: str(o.areaSearch),
      purpose: str(o.purpose),
      targetIndustries: strArr(o.targetIndustries),
      targetSize: str(o.targetSize),
      subsidyRate: str(o.subsidyRate),
      subsidyMax: str(o.subsidyMax),
      keyRequirements: strArr(o.keyRequirements),
      applicationFrames: strArr(o.applicationFrames),
      typicalSchedule: str(o.typicalSchedule),
      budgetBasis: str(o.budgetBasis),
      officialUrl: str(o.officialUrl),
      scheduleKey: str(o.scheduleKey) || name,
      status: str(o.status) || "watch",
      nextOpen: str(o.nextOpen),
      confidence: clampConf(o.confidence),
      isLargeAmount: !!o.isLargeAmount,
      isStartup: !!o.isStartup,
      unifiedWith: str(o.unifiedWith),
      sources: strArr(o.sources),
      notes: str(o.notes),
    });
    if (out.length >= max) break;
  }
  return out;
}

export { normalize as normalizeDiscovered };

export interface DiscoverOptions {
  /** 追加収集する上限件数（既定6）。 */
  max?: number;
}

/**
 * 関心領域に合う未収録の制度を発掘して RawProgram[] で返す。
 * 失敗時は例外を投げる（呼び出し側で握りつぶしてスキップ）。
 */
export async function discoverPrograms(
  profile: DiscoverProfile,
  existingNames: string[],
  existingSlugs: string[],
  options: DiscoverOptions = {},
): Promise<RawProgram[]> {
  const max = options.max ?? 6;
  const client = new Anthropic();

  const locality = [profile.prefecture, profile.city].filter(Boolean).join("");
  const userContent = [
    "## 事業者プロフィール",
    profileText(profile),
    "",
    "## 既存カタログにある制度名（これらは返さない）",
    existingNames.join(" / "),
    "",
    `この事業者の関心・目的に合致するが上記カタログに無い制度を、Web検索で実在確認して最大${max}件、submit_programs で返してください。該当が無ければ空配列で。`,
    locality
      ? `特に所在地（${locality}）の市区町村・都道府県レベルの地元補助金を必ず調べ、該当があれば優先的に含めてください。`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const webSearch: Anthropic.Messages.WebSearchTool20260209 = {
    type: "web_search_20260209",
    name: "web_search",
  };
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userContent },
  ];
  // web_search_20260209 は内部でコード実行を使うため pause_turn 継続時に container を引き継ぐ。
  let containerId: string | undefined;

  for (let i = 0; i < MAX_CONTINUATIONS; i++) {
    // Web検索で長時間化しうるため streaming（HTTPタイムアウト回避）。
    const res = await client.messages
      .stream({
        model: MODEL,
        max_tokens: 16000,
        temperature: 0,
        system: SYSTEM,
        tool_choice: { type: "auto" },
        tools: [webSearch, SUBMIT_TOOL],
        messages,
        ...(containerId ? { container: containerId } : {}),
      })
      .finalMessage();
    const submit = res.content.find(
      (b) => b.type === "tool_use" && b.name === "submit_programs",
    );
    if (submit && submit.type === "tool_use") {
      return normalize(
        submit.input,
        new Set(existingSlugs),
        new Set(existingNames),
        max,
      );
    }
    if (res.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: res.content });
      containerId = res.container?.id ?? containerId;
      continue;
    }
    console.warn(`[discover] submit無しで終了 stop_reason=${res.stop_reason}`);
    break;
  }
  return [];
}
