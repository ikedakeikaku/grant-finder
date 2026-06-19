import { describe, expect, it } from "vitest";
import { formatJst, renderNotificationEmail } from "./render";

const now = new Date("2026-06-19T09:00:00+09:00");

describe("formatJst", () => {
  it("JSTで整形する", () => {
    const s = formatJst(new Date("2026-07-24T08:30:00Z")); // 17:30 JST
    expect(s).toContain("2026");
    expect(s).toContain("7");
    expect(s).toContain("24");
  });
});

describe("renderNotificationEmail", () => {
  const base = {
    subsidyTitle: "ものづくり補助金",
    subsidyUrl: "https://www.jgrants-portal.go.jp/subsidy/X",
    acceptanceEnd: new Date("2026-07-19T00:00:00+09:00"),
    reasons: ["全国対象", "目的が合致（設備整備・IT導入をしたい）"],
    appBaseUrl: "https://example.com/dashboard",
    now,
  };

  it("締切30日前の件名と本文", () => {
    const r = renderNotificationEmail({ type: "deadline_30d", ...base });
    expect(r.subject).toBe("【締切30日前】ものづくり補助金");
    expect(r.text).toContain("残り約30日");
    expect(r.text).toContain("目的が合致");
    expect(r.text).toContain("https://www.jgrants-portal.go.jp/subsidy/X");
    expect(r.text).toContain("出典：Jグランツポータル");
    expect(r.html).toContain("<a href=");
  });

  it("new_match の件名", () => {
    const r = renderNotificationEmail({ type: "new_match", ...base });
    expect(r.subject).toBe(
      "【新着】あなたに合いそうな補助金：ものづくり補助金",
    );
  });

  it("HTMLは特殊文字をエスケープする", () => {
    const r = renderNotificationEmail({
      type: "new_match",
      ...base,
      subsidyTitle: "A&B<補助>",
    });
    expect(r.html).toContain("A&amp;B&lt;補助&gt;");
  });
});
