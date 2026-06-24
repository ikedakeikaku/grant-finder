import { describe, expect, it } from "vitest";
import {
  baseScheduleKey,
  dedupeByProgramFamily,
  dedupeByScheduleKey,
  isSameProgram,
  normalizeProgramName,
  overlapsAnyName,
} from "./dedupe";

describe("dedupeByScheduleKey", () => {
  it("同一scheduleKeyは締切が最も近い1件に集約", () => {
    const items = [
      {
        id: "a20",
        scheduleKey: "ものづくり",
        acceptanceEnd: "2026-12-28T00:00:00Z",
      },
      {
        id: "a19",
        scheduleKey: "ものづくり",
        acceptanceEnd: "2026-09-28T00:00:00Z",
      },
      {
        id: "a22",
        scheduleKey: "ものづくり",
        acceptanceEnd: "2027-06-30T00:00:00Z",
      },
    ];
    const out = dedupeByScheduleKey(items);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("a19"); // 最も近い締切
  });

  it("scheduleKeyが空のものは全件残す", () => {
    const items = [
      { id: "x", scheduleKey: null, acceptanceEnd: "2026-09-01T00:00:00Z" },
      { id: "y", scheduleKey: "", acceptanceEnd: "2026-10-01T00:00:00Z" },
    ];
    expect(dedupeByScheduleKey(items)).toHaveLength(2);
  });

  it("締切nullは最後（締切ありを優先して残す）", () => {
    const items = [
      { id: "n", scheduleKey: "k", acceptanceEnd: null },
      { id: "d", scheduleKey: "k", acceptanceEnd: "2026-09-01T00:00:00Z" },
    ];
    const out = dedupeByScheduleKey(items);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("d");
  });

  it("異なる制度はそれぞれ残る", () => {
    const items = [
      {
        id: "m",
        scheduleKey: "ものづくり",
        acceptanceEnd: "2026-09-01T00:00:00Z",
      },
      { id: "i", scheduleKey: "IT導入", acceptanceEnd: "2026-10-01T00:00:00Z" },
    ];
    expect(dedupeByScheduleKey(items)).toHaveLength(2);
  });
});

describe("normalizeProgramName", () => {
  it("年度・回次・括弧・記号・空白を落とす", () => {
    expect(normalizeProgramName("【令和8年度】省CO2型システムへの改修支援事業")).toBe(
      normalizeProgramName("省CO2型システムへの改修支援事業"),
    );
    expect(normalizeProgramName("小規模事業者持続化補助金＜創業型＞")).toBe(
      "小規模事業者持続化補助金創業型",
    );
    expect(normalizeProgramName("第20回 ものづくり補助金")).toBe(
      "ものづくり補助金",
    );
  });
});

describe("isSameProgram", () => {
  it("年度・回次・括弧違いを同一制度とみなす", () => {
    expect(
      isSameProgram(
        "【令和8年度】省CO2型システムへの改修支援事業",
        "省CO2型システムへの改修支援事業 SHIFT",
      ),
    ).toBe(true);
    expect(
      isSameProgram("小規模事業者持続化補助金＜創業型＞", "小規模事業者持続化補助金"),
    ).toBe(true);
  });

  it("別制度は同一とみなさない", () => {
    expect(
      isSameProgram("省CO2型システムへの改修支援事業", "ものづくり補助金"),
    ).toBe(false);
  });

  it("短すぎる名前は誤一致を避けて false", () => {
    expect(isSameProgram("IT", "IT導入補助金")).toBe(false);
  });
});

describe("overlapsAnyName", () => {
  it("候補のいずれかと同一制度なら true", () => {
    const proposals = ["小規模事業者持続化補助金＜創業型＞", "ものづくり補助金"];
    expect(overlapsAnyName("小規模事業者持続化補助金", proposals)).toBe(true);
    expect(overlapsAnyName("省CO2型システムへの改修支援事業", proposals)).toBe(
      false,
    );
  });
});

describe("baseScheduleKey", () => {
  it("末尾の枠を落として親キーにする", () => {
    expect(
      baseScheduleKey(
        "中小企業生産性革命推進事業_事業承継・M&A補助金_PMI推進枠(事業統合投資類型)",
      ),
    ).toBe("中小企業生産性革命推進事業_事業承継・M&A補助金");
  });
  it("枠を含まないキーはそのまま", () => {
    expect(baseScheduleKey("東京都_創業助成事業")).toBe("東京都_創業助成事業");
  });
  it("null はそのまま", () => {
    expect(baseScheduleKey(null)).toBe(null);
  });
});

describe("dedupeByProgramFamily", () => {
  it("同一補助金の枠違いを締切が最も近い1件に集約", () => {
    const k = "中小企業生産性革命推進事業_事業承継・M&A補助金";
    const items = [
      { id: "pmi1", scheduleKey: `${k}_PMI推進枠(事業統合投資類型)`, acceptanceEnd: "2026-07-24T00:00:00Z" },
      { id: "pmi2", scheduleKey: `${k}_PMI推進枠(PMI専門家活用類型)`, acceptanceEnd: "2026-07-24T00:00:00Z" },
      { id: "sokushin", scheduleKey: `${k}_事業承継促進枠`, acceptanceEnd: "2026-06-30T00:00:00Z" },
    ];
    const out = dedupeByProgramFamily(items);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("sokushin"); // 締切が最も近い枠
  });
  it("別補助金は別々に残る", () => {
    const items = [
      { id: "a", scheduleKey: "国_持続化補助金_一般枠", acceptanceEnd: "2026-09-01T00:00:00Z" },
      { id: "b", scheduleKey: "国_ものづくり補助金_通常枠", acceptanceEnd: "2026-09-01T00:00:00Z" },
    ];
    expect(dedupeByProgramFamily(items)).toHaveLength(2);
  });
});
