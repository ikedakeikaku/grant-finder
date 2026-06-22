import { describe, expect, it } from "vitest";
import { applyBudgetSignal, predictNextOpening } from "./prediction";

const now = new Date("2026-06-20T00:00:00Z");

describe("predictNextOpening", () => {
  it("履歴2回未満はnull", () => {
    expect(predictNextOpening([], now)).toBeNull();
    expect(
      predictNextOpening([new Date("2025-09-01T00:00:00Z")], now),
    ).toBeNull();
  });

  it("例年9月開始なら次回は当年9月を予測", () => {
    const p = predictNextOpening(
      [new Date("2024-09-05T00:00:00Z"), new Date("2025-09-10T00:00:00Z")],
      now,
    );
    expect(p).not.toBeNull();
    expect(p!.month).toBe(9);
    expect(p!.from.toISOString().slice(0, 7)).toBe("2026-09");
    expect(p!.basis).toContain("例年9月");
    expect(p!.sampleSize).toBe(2);
  });

  it("例年の月が現在より前なら翌年を予測", () => {
    // 例年3月開始、現在は6月 → 次回は翌年3月
    const p = predictNextOpening(
      [new Date("2024-03-01T00:00:00Z"), new Date("2025-03-02T00:00:00Z")],
      now,
    );
    expect(p!.month).toBe(3);
    expect(p!.from.getUTCFullYear()).toBe(2027);
  });

  it("月が集中しているほど信頼度が高い", () => {
    const concentrated = predictNextOpening(
      [
        new Date("2023-09-01T00:00:00Z"),
        new Date("2024-09-01T00:00:00Z"),
        new Date("2025-09-01T00:00:00Z"),
      ],
      now,
    )!;
    const scattered = predictNextOpening(
      [new Date("2024-09-01T00:00:00Z"), new Date("2025-04-01T00:00:00Z")],
      now,
    )!;
    expect(concentrated.confidence).toBeGreaterThan(scattered.confidence);
  });
});

describe("applyBudgetSignal", () => {
  const base = predictNextOpening(
    [new Date("2024-09-01T00:00:00Z"), new Date("2025-09-01T00:00:00Z")],
    now,
  )!;

  it("シグナルが無ければ予測はそのまま", () => {
    expect(applyBudgetSignal(base, null)).toEqual(base);
  });

  it("予算シグナルで信頼度が上がり根拠に明記される", () => {
    const out = applyBudgetSignal(base, "tousho", new Date("2026-04-10T00:00:00Z"));
    expect(out.confidence).toBeGreaterThan(base.confidence);
    expect(out.basis).toContain("当初予算成立");
    expect(out.basis).toContain("2026/4");
  });

  it("当初予算成立は概算要求より強く押し上げる", () => {
    const tousho = applyBudgetSignal(base, "tousho");
    const gaisan = applyBudgetSignal(base, "gaisan_youkyuu");
    expect(tousho.confidence).toBeGreaterThan(gaisan.confidence);
  });

  it("信頼度は1を超えない", () => {
    const high = { ...base, confidence: 0.95 };
    expect(applyBudgetSignal(high, "tousho").confidence).toBeLessThanOrEqual(1);
  });
});
