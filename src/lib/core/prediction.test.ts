import { describe, expect, it } from "vitest";
import { predictNextOpening } from "./prediction";

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
