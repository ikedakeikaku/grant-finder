import { describe, expect, it } from "vitest";
import {
  planNotifications,
  preAnnounceDue,
  shouldSendNow,
} from "./notify-plan";

const now = new Date("2026-06-19T09:00:00+09:00");
const inDays = (d: number) => new Date(now.getTime() + d * 24 * 60 * 60 * 1000);

describe("planNotifications", () => {
  it("初回は new_match を必ず含む", () => {
    const p = planNotifications(
      { existingTypes: [], acceptanceEnd: inDays(100) },
      now,
    );
    expect(p).toContain("new_match");
  });

  it("new_match 済みなら締切通知のみ", () => {
    const p = planNotifications(
      { existingTypes: ["new_match"], acceptanceEnd: inDays(14) },
      now,
    );
    expect(p).toEqual(["deadline_30d", "deadline_14d"]);
  });

  it("既に送った締切種別は除外（差分のみ）", () => {
    const p = planNotifications(
      {
        existingTypes: ["new_match", "deadline_30d"],
        acceptanceEnd: inDays(14),
      },
      now,
    );
    expect(p).toEqual(["deadline_14d"]);
  });

  it("締切日が無ければ new_match のみ", () => {
    const p = planNotifications(
      { existingTypes: [], acceptanceEnd: null },
      now,
    );
    expect(p).toEqual(["new_match"]);
  });

  it("締切超過なら締切通知は出さない", () => {
    const p = planNotifications(
      { existingTypes: ["new_match"], acceptanceEnd: inDays(-1) },
      now,
    );
    expect(p).toEqual([]);
  });
});

describe("preAnnounceDue（予測の公募前予告：60日前）", () => {
  it("公募開始まで61日はまだ出さない", () => {
    expect(preAnnounceDue(inDays(61), now)).toBe(false);
  });
  it("ちょうど60日前は出す", () => {
    expect(preAnnounceDue(inDays(60), now)).toBe(true);
  });
  it("直前(0日)も出す", () => {
    expect(preAnnounceDue(inDays(0), now)).toBe(true);
  });
  it("公募開始を過ぎたら出さない", () => {
    expect(preAnnounceDue(inDays(-1), now)).toBe(false);
  });
});

describe("shouldSendNow", () => {
  it("緊急通知があれば間隔に関係なく送る", () => {
    expect(shouldSendNow(inDays(-1), now, true, 3)).toBe(true);
  });
  it("直近送信が無ければ送る", () => {
    expect(shouldSendNow(null, now, false, 3)).toBe(true);
  });
  it("最短間隔未満は見送り（束ねる）", () => {
    expect(shouldSendNow(inDays(-1), now, false, 3)).toBe(false);
    expect(shouldSendNow(inDays(-2), now, false, 3)).toBe(false);
  });
  it("最短間隔を過ぎたら送る", () => {
    expect(shouldSendNow(inDays(-3), now, false, 3)).toBe(true);
    expect(shouldSendNow(inDays(-5), now, false, 3)).toBe(true);
  });
});
