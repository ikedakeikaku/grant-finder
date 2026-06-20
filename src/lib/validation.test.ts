import { describe, expect, it } from "vitest";
import { parseLoginForm, parseProfileForm } from "./validation";

function form(entries: Array<[string, string]>): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe("parseLoginForm", () => {
  it("メールアドレス形式を検証する", () => {
    expect(parseLoginForm(form([["email", "user@example.com"]])).success).toBe(
      true,
    );
    expect(parseLoginForm(form([["email", "not-email"]])).success).toBe(false);
  });
});

describe("parseProfileForm", () => {
  it("統制語彙と自由入力の上限を検証する", () => {
    const ok = parseProfileForm(
      form([
        ["name", "テスト商店"],
        ["industry", "情報通信業"],
        ["prefecture", "東京都"],
        ["purposes", "設備整備・IT導入をしたい"],
        ["interests", "DX, 省力化"],
        ["plannedInvestment", "予約システムを導入したい"],
        ["notifyEmail", "owner@example.com"],
      ]),
    );
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.interests).toEqual(["DX", "省力化"]);

    const bad = parseProfileForm(
      form([
        ["name", "テスト商店"],
        ["industry", "任意の業種"],
        ["prefecture", "東京都"],
      ]),
    );
    expect(bad.success).toBe(false);
  });

  it("過大なタグ数や自由記述を拒否する", () => {
    const tooManyTags = Array.from({ length: 21 }, (_, i) => `tag${i}`).join(
      ",",
    );
    const result = parseProfileForm(
      form([
        ["name", "テスト商店"],
        ["interests", tooManyTags],
        ["plannedInvestment", "x".repeat(1001)],
      ]),
    );
    expect(result.success).toBe(false);
  });
});
