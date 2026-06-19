import { describe, expect, it } from "vitest";
import {
  computeSubsidyStatus,
  deriveScheduleKey,
  normalizeSubsidy,
  parseJgrantsDate,
} from "./normalize";
import type { JGrantsDetail } from "./types";

// 実際の jGrants 詳細API レスポンスを基にしたフィクスチャ
const fixture: JGrantsDetail = {
  id: "a0WJ200000CDapgMAD",
  name: "S-00009341",
  title:
    "中小企業生産性革命推進事業_事業承継・M&A補助金(15次公募)_事業承継促進枠",
  subsidy_catch_phrase: "事業承継・M&A補助金",
  detail: "<p>本文</p>",
  use_purpose: "事業を引き継ぎたい",
  industry: "建設業 / 製造業 / 情報通信業",
  target_area_search: "全国",
  target_area_detail: null,
  target_number_of_employees: "従業員数の制約なし",
  subsidy_rate: "2/3 以内又は 1/2 以内",
  subsidy_max_limit: 10000000,
  acceptance_start_datetime: "2026-06-19T06:00Z",
  acceptance_end_datetime: "2026-07-24T08:30Z",
  project_end_deadline: null,
  request_reception_presence: "有",
  is_enable_multiple_request: false,
  front_subsidy_detail_page_url:
    "https://www.jgrants-portal.go.jp/subsidy/a0WJ200000CDapgMAD",
  application_guidelines: [],
  outline_of_grant: [],
  institution_name:
    "中小企業生産性革命推進事業_事業承継・M&A事業補助金(15次公募)",
  application_form: [],
};

describe("parseJgrantsDate", () => {
  it("ミリ秒付きZ形式（一覧API）", () => {
    expect(parseJgrantsDate("2026-07-24T08:30:00.000Z")?.toISOString()).toBe(
      "2026-07-24T08:30:00.000Z",
    );
  });
  it("秒なしZ形式（詳細API）も解釈できる", () => {
    expect(parseJgrantsDate("2026-07-24T08:30Z")?.toISOString()).toBe(
      "2026-07-24T08:30:00.000Z",
    );
  });
  it("null/空はnull", () => {
    expect(parseJgrantsDate(null)).toBeNull();
    expect(parseJgrantsDate("")).toBeNull();
  });
});

describe("computeSubsidyStatus（境界値）", () => {
  const start = new Date("2026-06-19T06:00:00Z");
  const end = new Date("2026-07-24T08:30:00Z");
  it("開始前はupcoming", () => {
    expect(
      computeSubsidyStatus(start, end, new Date("2026-06-01T00:00:00Z")),
    ).toBe("upcoming");
  });
  it("受付中で締切まで余裕があればopen", () => {
    expect(
      computeSubsidyStatus(start, end, new Date("2026-07-01T00:00:00Z")),
    ).toBe("open");
  });
  it("締切ちょうど14日前はclosing_soon", () => {
    expect(
      computeSubsidyStatus(start, end, new Date("2026-07-10T08:30:00Z")),
    ).toBe("closing_soon");
  });
  it("締切15日前はまだopen", () => {
    expect(
      computeSubsidyStatus(start, end, new Date("2026-07-09T08:29:00Z")),
    ).toBe("open");
  });
  it("締切超過はclosed", () => {
    expect(
      computeSubsidyStatus(start, end, new Date("2026-07-25T00:00:00Z")),
    ).toBe("closed");
  });
});

describe("deriveScheduleKey（名寄せ）", () => {
  it("(N次公募)を除去する", () => {
    expect(deriveScheduleKey(fixture.title)).toBe(
      "中小企業生産性革命推進事業_事業承継・M&A補助金_事業承継促進枠",
    );
  });
  it("令和N年度・第N回を除去する", () => {
    expect(deriveScheduleKey("令和7年度 ものづくり補助金 第19回")).toBe(
      "ものづくり補助金",
    );
  });
  it("回情報が無ければそのまま", () => {
    expect(deriveScheduleKey("小規模事業者持続化補助金")).toBe(
      "小規模事業者持続化補助金",
    );
  });
});

describe("normalizeSubsidy", () => {
  const now = new Date("2026-07-01T00:00:00Z");
  it("詳細を DB 行へ正しくマップする", () => {
    const n = normalizeSubsidy(fixture, now);
    expect(n.id).toBe("a0WJ200000CDapgMAD");
    expect(n.catch_phrase).toBe("事業承継・M&A補助金"); // subsidy_catch_phrase → catch_phrase
    expect(n.acceptance_end_datetime).toBe("2026-07-24T08:30:00.000Z");
    expect(n.status).toBe("open");
    expect(n.schedule_key).toBe(
      "中小企業生産性革命推進事業_事業承継・M&A補助金_事業承継促進枠",
    );
    // raw はサニタイズ済みコピー（添付なしなら内容は元と等価）
    expect(n.raw).toEqual(fixture);
  });

  it("raw から添付の base64 本体を除去し、メタ情報は残す", () => {
    const withAttachment: JGrantsDetail = {
      ...fixture,
      application_guidelines: [{ name: "公募要領.pdf", data: "BASE64DATA==" }],
      application_form: [{ name: "様式1.docx", file_data: "BASE64DATA==" }],
    };
    const n = normalizeSubsidy(withAttachment, now);
    const raw = n.raw as {
      application_guidelines: Record<string, unknown>[];
      application_form: Record<string, unknown>[];
    };
    expect(raw.application_guidelines[0]).toEqual({ name: "公募要領.pdf" });
    expect(raw.application_guidelines[0]).not.toHaveProperty("data");
    expect(raw.application_form[0]).toEqual({ name: "様式1.docx" });
    expect(raw.application_form[0]).not.toHaveProperty("file_data");
  });
});
