/**
 * jGrants 公開API の型定義。
 * 実際の API レスポンスを確認して定義している（推測ではなく実形状ベース）。
 * 出典: Jグランツポータル https://www.jgrants-portal.go.jp
 */

/** 一覧API (`/v1/public/subsidies`) の各要素 */
export interface JGrantsListItem {
  id: string;
  name: string | null; // 管理番号 (例: "S-00009341")
  title: string;
  acceptance_start_datetime: string | null;
  acceptance_end_datetime: string | null;
  subsidy_max_limit: number | null;
  target_area_search: string | null;
  target_number_of_employees: string | null;
  institution_name: string | null;
}

/** 詳細API (`/v1/public/subsidies/id/{id}`) の要素（一覧項目に本文等が加わる） */
export interface JGrantsDetail extends JGrantsListItem {
  subsidy_catch_phrase: string | null;
  detail: string | null; // HTML
  use_purpose: string | null; // 例: "事業を引き継ぎたい"
  industry: string | null; // 例: "建設業 / 製造業 / ..."
  target_area_detail: string | null;
  subsidy_rate: string | null; // 例: "2/3 以内又は 1/2 以内"
  project_end_deadline: string | null;
  request_reception_presence: string | null;
  is_enable_multiple_request: boolean | null;
  front_subsidy_detail_page_url: string | null;
  application_guidelines: unknown[];
  outline_of_grant: unknown[];
  application_form: unknown[];
}

export interface JGrantsResponse<T> {
  metadata: { type: string; resultset: { count: number } };
  result: T[];
}

export type JGrantsListResponse = JGrantsResponse<JGrantsListItem>;
export type JGrantsDetailResponse = JGrantsResponse<JGrantsDetail>;

export interface ListSubsidiesParams {
  /** 2文字以上必須 */
  keyword: string;
  sort?:
    | "created_date"
    | "acceptance_start_datetime"
    | "acceptance_end_datetime";
  order?: "ASC" | "DESC";
  /** 1: 受付中のみ / 0: すべて */
  acceptance?: 0 | 1;
}
