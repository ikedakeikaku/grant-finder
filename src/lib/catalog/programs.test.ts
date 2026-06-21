import { describe, it, expect } from "vitest";
import {
  programId,
  toProgramRow,
  isProgramInArea,
  formatSubsidyMax,
  decodeEntities,
  parseYen,
  parseMonthIso,
  fromResearchRecord,
  CATALOG_PROGRAMS,
  type CatalogProgram,
  type RawProgram,
} from "./programs";

const base: CatalogProgram = {
  slug: "x",
  name: "テスト補助金",
  level: "prefecture",
  prefecture: "山梨県",
  areaSearch: "山梨県",
  purpose: "設備投資",
  targetIndustries: ["全業種"],
  targetSize: "中小企業者",
  subsidyRate: "1/2",
  subsidyMax: 5_000_000,
  keyRequirements: [],
  applicationFrames: [],
  typicalSchedule: null,
  budgetBasis: null,
  officialUrl: null,
  scheduleKey: null,
  status: "active",
  nextOpenFrom: null,
  nextOpenTo: null,
  confidence: 0.5,
  isLargeAmount: false,
  isStartup: false,
  unifiedWith: null,
  sources: [],
  notes: null,
  source: "manual",
};

describe("programId", () => {
  it("slug に prog: を付ける", () => {
    expect(programId("monozukuri")).toBe("prog:monozukuri");
  });
});

describe("isProgramInArea", () => {
  it("国制度は常に対象", () => {
    expect(
      isProgramInArea(
        { level: "national", areaSearch: "全国", prefecture: null },
        "山梨県",
      ),
    ).toBe(true);
  });
  it("都道府県一致で対象", () => {
    expect(isProgramInArea(base, "山梨県")).toBe(true);
  });
  it("他県は対象外", () => {
    expect(isProgramInArea(base, "東京都")).toBe(false);
  });
  it("市区町村一致で対象", () => {
    const muni = { ...base, areaSearch: "甲府市", prefecture: "山梨県" };
    expect(isProgramInArea(muni, "東京都", "甲府市")).toBe(true);
  });
  it("所在地不明なら除外しない", () => {
    expect(isProgramInArea(base, null, null)).toBe(true);
  });
});

describe("formatSubsidyMax", () => {
  it("万円表示", () => {
    expect(formatSubsidyMax(5_000_000)).toBe("最大500万円");
  });
  it("億円表示", () => {
    expect(formatSubsidyMax(100_000_000)).toBe("最大1億円");
    expect(formatSubsidyMax(150_000_000)).toBe("最大1.5億円");
  });
  it("不明は要確認", () => {
    expect(formatSubsidyMax(null)).toBe("金額は要確認");
    expect(formatSubsidyMax(0)).toBe("金額は要確認");
  });
});

describe("toProgramRow", () => {
  it("snake_case の DB 行に変換し id を付与", () => {
    const row = toProgramRow(base);
    expect(row.id).toBe("prog:x");
    expect(row.area_search).toBe("山梨県");
    expect(row.subsidy_max).toBe(5_000_000);
    expect(row.target_industries).toEqual(["全業種"]);
    expect(row.is_startup).toBe(false);
  });
});

describe("decodeEntities", () => {
  it("HTMLエンティティを戻す", () => {
    expect(decodeEntities("事業承継・M&amp;A補助金")).toBe(
      "事業承継・M&A補助金",
    );
    expect(decodeEntities("&lt;x&gt;&quot;a&quot;")).toBe('<x>"a"');
  });
});

describe("parseYen", () => {
  it("先頭の円額を取り出す", () => {
    expect(parseYen("100000000")).toBe(100_000_000);
    expect(parseYen("1500000000（先進…15億円…）")).toBe(1_500_000_000);
    expect(parseYen("5,000,000")).toBe(5_000_000);
  });
  it("不明は null", () => {
    expect(parseYen("")).toBeNull();
    expect(parseYen(null)).toBeNull();
    expect(parseYen("未定")).toBeNull();
  });
});

describe("parseMonthIso", () => {
  it("YYYY-MM を月初ISOに", () => {
    expect(parseMonthIso("2026-07")).toBe("2026-07-01T00:00:00.000Z");
    expect(parseMonthIso("2026-06-19")).toBe("2026-06-19T00:00:00.000Z");
  });
  it("解釈不能は null", () => {
    expect(parseMonthIso("")).toBeNull();
    expect(parseMonthIso("未定")).toBeNull();
    expect(parseMonthIso("2026-13")).toBeNull();
  });
});

describe("fromResearchRecord", () => {
  const raw: RawProgram = {
    slug: "x",
    name: "テスト&amp;補助金",
    level: "prefecture",
    prefecture: "山梨県",
    areaSearch: "山梨県",
    purpose: "設備投資",
    targetIndustries: ["全業種"],
    targetSize: "中小企業者",
    subsidyRate: "2/3",
    subsidyMax: "10000000（…）",
    keyRequirements: ["GビズID"],
    applicationFrames: ["通常枠"],
    typicalSchedule: "例年5月",
    budgetBasis: "令和8年度実施",
    officialUrl: "https://example.jp",
    scheduleKey: "テスト補助金",
    status: "active",
    nextOpen: "2026-05",
    confidence: 1.5,
    isLargeAmount: true,
    isStartup: false,
    unifiedWith: "",
    sources: ["https://example.jp"],
    notes: "",
  };
  it("文字列金額/年月/エンティティを正規化", () => {
    const p = fromResearchRecord(raw);
    expect(p.name).toBe("テスト&補助金");
    expect(p.subsidyMax).toBe(10_000_000);
    expect(p.nextOpenFrom).toBe("2026-05-01T00:00:00.000Z");
    expect(p.confidence).toBe(1); // クランプ
    expect(p.unifiedWith).toBeNull();
    expect(p.source).toBe("research");
  });
  it("不正な level/status は既定にフォールバック", () => {
    const p = fromResearchRecord({ ...raw, level: "x", status: "y" });
    expect(p.level).toBe("national");
    expect(p.status).toBe("watch");
  });
  it("国制度で prefecture 空なら null", () => {
    const p = fromResearchRecord({
      ...raw,
      level: "national",
      prefecture: "",
    });
    expect(p.prefecture).toBeNull();
  });
});

describe("CATALOG_PROGRAMS シード", () => {
  it("slug が一意", () => {
    const slugs = CATALOG_PROGRAMS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
  it("各制度に名称と対象地域がある", () => {
    for (const p of CATALOG_PROGRAMS) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.areaSearch.length).toBeGreaterThan(0);
    }
  });
  it("十分な件数を収録（国＋4都府県）", () => {
    expect(CATALOG_PROGRAMS.length).toBeGreaterThanOrEqual(30);
    const prefs = new Set(
      CATALOG_PROGRAMS.filter((p) => p.prefecture).map((p) => p.prefecture),
    );
    for (const pref of ["東京都", "大阪府", "神奈川県", "山梨県"]) {
      expect(prefs.has(pref)).toBe(true);
    }
    expect(CATALOG_PROGRAMS.some((p) => p.level === "national")).toBe(true);
  });
  it("名称・備考に未デコードのエンティティが残らない", () => {
    for (const p of CATALOG_PROGRAMS) {
      expect(p.name).not.toContain("&amp;");
    }
  });
});
