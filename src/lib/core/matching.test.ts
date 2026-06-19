import { describe, expect, it } from "vitest";
import {
  isAreaEligible,
  isSizeEligible,
  matchIndustry,
  matchedInterests,
  parseEmployeeCeiling,
  scoreMatch,
  type BusinessProfile,
  type SubsidyForMatch,
} from "./matching";

describe("isAreaEligible", () => {
  it("全国は常に適格", () => {
    expect(isAreaEligible("全国", "大阪府")).toBe(true);
  });
  it("対象に所在地が含まれれば適格", () => {
    expect(isAreaEligible("東京都 / 神奈川県", "東京都")).toBe(true);
  });
  it("対象外の都道府県は不適格", () => {
    expect(isAreaEligible("東京都 / 神奈川県", "大阪府")).toBe(false);
  });
  it("対象指定なし・所在地不明は不適格にしない", () => {
    expect(isAreaEligible(null, "大阪府")).toBe(true);
    expect(isAreaEligible("東京都", null)).toBe(true);
  });
  it("市区町村が対象に含まれれば適格（自治体補助金）", () => {
    expect(isAreaEligible("甲府市", "山梨県", "甲府市")).toBe(true);
  });
  it("都道府県も市区町村も対象外なら不適格", () => {
    expect(isAreaEligible("東京都", "山梨県", "甲府市")).toBe(false);
  });
});

describe("matchIndustry", () => {
  it("制約なし(null)はrestricted=false", () => {
    expect(matchIndustry(null, "製造業")).toEqual({
      restricted: false,
      match: false,
    });
  });
  it("対象業種に含まれる", () => {
    expect(matchIndustry("建設業 / 製造業 / 情報通信業", "製造業")).toEqual({
      restricted: true,
      match: true,
    });
  });
  it("対象業種に含まれない", () => {
    expect(matchIndustry("建設業 / 製造業", "宿泊業")).toEqual({
      restricted: true,
      match: false,
    });
  });
});

describe("parseEmployeeCeiling", () => {
  it("制約なし", () => {
    expect(parseEmployeeCeiling("従業員数の制約なし")).toEqual({
      kind: "unlimited",
    });
  });
  it("20人以下 → inclusive上限20", () => {
    expect(parseEmployeeCeiling("従業員20人以下")).toEqual({
      kind: "limit",
      max: 20,
      inclusive: true,
    });
  });
  it("300名未満 → exclusive上限300", () => {
    expect(parseEmployeeCeiling("常時使用する従業員が300名未満")).toEqual({
      kind: "limit",
      max: 300,
      inclusive: false,
    });
  });
  it("解釈できない文言はunknown", () => {
    expect(parseEmployeeCeiling("中小企業者")).toEqual({ kind: "unknown" });
  });
});

describe("isSizeEligible（境界値）", () => {
  it("上限ちょうど(以下)は適格", () => {
    expect(isSizeEligible("従業員20人以下", 20)).toBe(true);
  });
  it("上限+1は不適格", () => {
    expect(isSizeEligible("従業員20人以下", 21)).toBe(false);
  });
  it("未満の上限ちょうどは不適格", () => {
    expect(isSizeEligible("300名未満", 300)).toBe(false);
  });
  it("人数未入力・制約不明は除外しない", () => {
    expect(isSizeEligible("従業員20人以下", null)).toBe(true);
    expect(isSizeEligible("中小企業者", 9999)).toBe(true);
  });
});

describe("matchedInterests", () => {
  it("含まれる関心語のみ返す", () => {
    expect(
      matchedInterests(["DX", "省力化", "輸出"], "省力化投資でDXを推進"),
    ).toEqual(["DX", "省力化"]);
  });
});

// --- 総合スコア ---------------------------------------------------------

const baseProfile: BusinessProfile = {
  industry: "製造業",
  prefecture: "東京都",
  city: null,
  employeeCount: 30,
  purposes: ["設備整備・IT導入をしたい"],
  interests: ["省力化"],
};

const baseSubsidy: SubsidyForMatch = {
  usePurpose: "設備整備・IT導入をしたい",
  industry: "建設業 / 製造業",
  targetAreaSearch: "全国",
  targetNumberOfEmployees: "従業員数の制約なし",
  title: "ものづくり・省力化補助金",
  catchPhrase: null,
};

describe("scoreMatch", () => {
  it("地域外なら不適格(score=0)", () => {
    const r = scoreMatch(baseProfile, {
      ...baseSubsidy,
      targetAreaSearch: "大阪府",
    });
    expect(r.eligible).toBe(false);
    expect(r.score).toBe(0);
    expect(r.reasons).toContain("対象地域外");
  });

  it("業種外なら不適格", () => {
    const r = scoreMatch({ ...baseProfile, industry: "宿泊業" }, baseSubsidy);
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain("対象業種外");
  });

  it("規模超過なら不適格", () => {
    const r = scoreMatch(
      { ...baseProfile, employeeCount: 21 },
      { ...baseSubsidy, targetNumberOfEmployees: "従業員20人以下" },
    );
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain("従業員規模が対象外");
  });

  it("全条件一致なら高スコア", () => {
    const r = scoreMatch(baseProfile, baseSubsidy);
    expect(r.eligible).toBe(true);
    // base0.25 + purpose0.45 + industry0.15 + interest0.15 = 1.0
    expect(r.score).toBeCloseTo(1.0, 5);
    expect(r.reasons).toContain("目的が合致（設備整備・IT導入をしたい）");
    expect(r.reasons).toContain("業種が対象に含まれる（製造業）");
    expect(r.reasons).toContain("関心に合致（省力化）");
  });

  it("目的が部分一致ならスコアは比例", () => {
    const r = scoreMatch(
      {
        ...baseProfile,
        purposes: ["設備整備・IT導入をしたい", "販路を広げたい"],
        interests: [],
      },
      baseSubsidy,
    );
    // base0.25 + purpose0.45*(1/2) + industry0.15 = 0.625
    expect(r.score).toBeCloseTo(0.625, 5);
  });

  it("適格だが目的・関心・業種一致なしでも基礎点は付く", () => {
    const r = scoreMatch(
      {
        industry: null,
        prefecture: null,
        city: null,
        employeeCount: null,
        purposes: [],
        interests: [],
      },
      { ...baseSubsidy, industry: null },
    );
    expect(r.eligible).toBe(true);
    expect(r.score).toBeCloseTo(0.25, 5);
  });

  it("地元自治体の補助金は加点され根拠に出る", () => {
    const r = scoreMatch(
      { ...baseProfile, prefecture: "山梨県", city: "甲府市", industry: null },
      {
        usePurpose: null,
        industry: null,
        targetAreaSearch: "山梨県",
        targetNumberOfEmployees: "中小企業者",
        title: "甲府市DX推進補助金",
        catchPhrase: null,
      },
    );
    expect(r.eligible).toBe(true);
    // base0.25 + local0.1 = 0.35（目的・業種一致なし）
    expect(r.score).toBeCloseTo(0.35, 5);
    expect(r.reasons.some((x) => x.includes("地元自治体"))).toBe(true);
  });
});
