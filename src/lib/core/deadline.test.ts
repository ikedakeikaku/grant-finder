import { describe, expect, it } from "vitest";
import {
  daysUntilDeadline,
  dueDeadlineNotifications,
  mostUrgentDeadlineNotification,
} from "./deadline";

const now = new Date("2026-06-19T09:00:00+09:00");
const inDays = (d: number) => new Date(now.getTime() + d * 24 * 60 * 60 * 1000);

describe("daysUntilDeadline", () => {
  it("締切当日は0", () => {
    expect(daysUntilDeadline(new Date("2026-06-19T23:00:00+09:00"), now)).toBe(
      0,
    );
  });
  it("翌日は1", () => {
    expect(daysUntilDeadline(inDays(1), now)).toBe(1);
  });
  it("過ぎた締切は負", () => {
    expect(daysUntilDeadline(inDays(-2), now)).toBe(-2);
  });
});

describe("dueDeadlineNotifications（境界値）", () => {
  it("31日前は何も該当しない", () => {
    expect(dueDeadlineNotifications(inDays(31), now)).toEqual([]);
  });
  it("ちょうど30日前は30dのみ", () => {
    expect(dueDeadlineNotifications(inDays(30), now)).toEqual(["deadline_30d"]);
  });
  it("ちょうど14日前は30dと14d", () => {
    expect(dueDeadlineNotifications(inDays(14), now)).toEqual([
      "deadline_30d",
      "deadline_14d",
    ]);
  });
  it("ちょうど7日前は3段階すべて", () => {
    expect(dueDeadlineNotifications(inDays(7), now)).toEqual([
      "deadline_30d",
      "deadline_14d",
      "deadline_7d",
    ]);
  });
  it("締切当日(0日)も3段階すべて該当", () => {
    expect(dueDeadlineNotifications(inDays(0), now)).toEqual([
      "deadline_30d",
      "deadline_14d",
      "deadline_7d",
    ]);
  });
  it("締切を過ぎたら何も返さない", () => {
    expect(dueDeadlineNotifications(inDays(-1), now)).toEqual([]);
  });
});

describe("mostUrgentDeadlineNotification", () => {
  it("31日前はnull", () => {
    expect(mostUrgentDeadlineNotification(inDays(31), now)).toBeNull();
  });
  it("20日前は14dではなく30d（まだ14d圏外）", () => {
    expect(mostUrgentDeadlineNotification(inDays(20), now)).toBe(
      "deadline_30d",
    );
  });
  it("10日前は最も緊急な14d", () => {
    expect(mostUrgentDeadlineNotification(inDays(10), now)).toBe(
      "deadline_14d",
    );
  });
  it("5日前は最も緊急な7d", () => {
    expect(mostUrgentDeadlineNotification(inDays(5), now)).toBe("deadline_7d");
  });
});
