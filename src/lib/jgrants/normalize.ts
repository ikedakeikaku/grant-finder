import type { JGrantsDetail } from "./types";

/** 補助金の受付状況（DB enum subsidy_status と一致） */
export type SubsidyStatus = "upcoming" | "open" | "closing_soon" | "closed";

/** 締切まで何日以内を「締切間近(closing_soon)」とみなすか */
export const CLOSING_SOON_DAYS = 14;

/** DB の subsidies 行に対応する正規化済みデータ（日付は ISO 文字列 or null） */
export interface NormalizedSubsidy {
  id: string;
  name: string | null;
  title: string;
  catch_phrase: string | null;
  detail: string | null;
  use_purpose: string | null;
  industry: string | null;
  target_area_search: string | null;
  target_area_detail: string | null;
  target_number_of_employees: string | null;
  subsidy_rate: string | null;
  subsidy_max_limit: number | null;
  acceptance_start_datetime: string | null;
  acceptance_end_datetime: string | null;
  project_end_deadline: string | null;
  institution_name: string | null;
  front_subsidy_detail_page_url: string | null;
  status: SubsidyStatus;
  schedule_key: string;
  raw: unknown;
}

/**
 * jGrants の日付文字列を Date に変換する。
 * 一覧は "2026-07-24T08:30:00.000Z"、詳細は "2026-07-24T08:30Z" のように
 * 秒を欠く形式が混在するため、両方を許容する。
 */
export function parseJgrantsDate(
  value: string | null | undefined,
): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) return d;
  // "YYYY-MM-DDThh:mmZ" のように秒が無い形式へのフォールバック
  const m = value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})Z$/);
  if (m) {
    const d2 = new Date(`${m[1]}:00Z`);
    if (!Number.isNaN(d2.getTime())) return d2;
  }
  return null;
}

/**
 * 公募の受付状況を算出する純粋関数。
 * - now < 開始: upcoming
 * - 開始 <= now <= 締切: open（締切まで CLOSING_SOON_DAYS 日以内なら closing_soon）
 * - now > 締切: closed
 * 開始/締切が不明な場合は安全側に open とみなす。
 */
export function computeSubsidyStatus(
  start: Date | null,
  end: Date | null,
  now: Date,
): SubsidyStatus {
  if (start && now.getTime() < start.getTime()) return "upcoming";
  if (end) {
    if (now.getTime() > end.getTime()) return "closed";
    const msLeft = end.getTime() - now.getTime();
    if (msLeft <= CLOSING_SOON_DAYS * 24 * 60 * 60 * 1000)
      return "closing_soon";
  }
  return "open";
}

/**
 * 制度の名寄せキーを作る純粋関数。
 * 回次・公募回・年度などの「その回だけの情報」を取り除き、
 * 例年パターン学習のために同一制度を束ねるキーを得る。
 *
 * 例: "中小企業生産性革命推進事業_事業承継・M&A補助金(15次公募)_事業承継促進枠"
 *   → "中小企業生産性革命推進事業_事業承継・M&A補助金_事業承継促進枠"
 */
export function deriveScheduleKey(title: string): string {
  let key = title;
  // 全角/半角カッコ内に「次/回/公募」を含むものを除去: (15次公募) （第3回） 等
  key = key.replace(/[（(][^（()]*?(?:次|回|公募|締切)[^（()]*?[)）]/g, "");
  // "第N回" "N次" "N次公募" 単独表記を除去
  key = key.replace(/第?\s*\d+\s*(?:次公募|次|回)/g, "");
  // 年度表記を除去: 令和7年度 / R7 / 2026年度
  key = key.replace(/令和\s*\d+\s*年度?/g, "");
  key = key.replace(/[Rr]\s*\d+\s*年?度?/g, "");
  key = key.replace(/\d{4}\s*年度?/g, "");
  // 区切りや空白の重複を整理
  key = key
    .replace(/[_＿]{2,}/g, "_")
    .replace(/\s{2,}/g, " ")
    .replace(/[_＿\s]+$/g, "")
    .replace(/^[_＿\s]+/g, "")
    .trim();
  return key.length > 0 ? key : title.trim();
}

/**
 * 添付ファイル配列から base64 本体（data 等）を取り除き、メタ情報だけ残す純粋関数。
 * jGrants 詳細APIの application_guidelines / outline_of_grant / application_form は
 * 公募要領PDF等を base64 で含むため、そのまま raw に保存すると1行が数MBになり
 * DB の文タイムアウト・転送エラーの原因になる。表示・名寄せに不要な本体だけ落とす。
 */
function stripAttachmentBinaries(items: unknown[]): unknown[] {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    if (!item || typeof item !== "object") return item;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
      // base64 本体とみられるフィールドは保存しない
      if (k === "data" || k === "file_data" || k === "base64") continue;
      out[k] = v;
    }
    return out;
  });
}

/**
 * raw 保存用に詳細レスポンスを軽量化する純粋関数。
 * 将来の項目追加に備えて全体を保持しつつ、巨大な添付本体だけ除去する。
 */
function sanitizeRawDetail(detail: JGrantsDetail): Record<string, unknown> {
  return {
    ...detail,
    application_guidelines: stripAttachmentBinaries(
      detail.application_guidelines,
    ),
    outline_of_grant: stripAttachmentBinaries(detail.outline_of_grant),
    application_form: stripAttachmentBinaries(detail.application_form),
  };
}

/**
 * 詳細APIの結果を DB 行（NormalizedSubsidy）に変換する純粋関数。
 * status の算出に「現在時刻」を注入する（テスト容易性のため）。
 */
export function normalizeSubsidy(
  detail: JGrantsDetail,
  now: Date,
): NormalizedSubsidy {
  const start = parseJgrantsDate(detail.acceptance_start_datetime);
  const end = parseJgrantsDate(detail.acceptance_end_datetime);
  const projectEnd = parseJgrantsDate(detail.project_end_deadline);

  return {
    id: detail.id,
    name: detail.name,
    title: detail.title,
    catch_phrase: detail.subsidy_catch_phrase,
    detail: detail.detail,
    use_purpose: detail.use_purpose,
    industry: detail.industry,
    target_area_search: detail.target_area_search,
    target_area_detail: detail.target_area_detail,
    target_number_of_employees: detail.target_number_of_employees,
    subsidy_rate: detail.subsidy_rate,
    subsidy_max_limit: detail.subsidy_max_limit,
    acceptance_start_datetime: start ? start.toISOString() : null,
    acceptance_end_datetime: end ? end.toISOString() : null,
    project_end_deadline: projectEnd ? projectEnd.toISOString() : null,
    institution_name: detail.institution_name,
    front_subsidy_detail_page_url: detail.front_subsidy_detail_page_url,
    status: computeSubsidyStatus(start, end, now),
    schedule_key: deriveScheduleKey(detail.title),
    raw: sanitizeRawDetail(detail),
  };
}
