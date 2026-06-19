import { describe, expect, it } from "vitest";
import { dedupeByScheduleKey } from "./dedupe";

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
