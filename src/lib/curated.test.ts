import { describe, expect, it } from "vitest";
import {
  CURATED_PROGRAMS,
  findOpenRound,
  isCuratedJgrantsTitle,
} from "./curated";

describe("isCuratedJgrantsTitle", () => {
  it("経産省ものづくりは抑制対象", () => {
    expect(
      isCuratedJgrantsTitle(
        "【経済産業省】ものづくり・商業・サービス生産性向上促進補助金（22次締切）",
      ),
    ).toBe(true);
  });
  it("地方版ものづくり(岡崎)は抑制しない", () => {
    expect(
      isCuratedJgrantsTitle("岡崎ものづくり支援補助金（新製品共創事業）"),
    ).toBe(false);
  });
});

describe("findOpenRound", () => {
  const monozukuri = CURATED_PROGRAMS[0]!;

  it("両回とも申請締切後なら現在公募中の回はない", () => {
    // 2026-06-20 時点では 22次(〜1/30)・23次(〜5/8) とも終了
    const now = new Date("2026-06-20T00:00:00+09:00");
    expect(findOpenRound(monozukuri, now)).toBeNull();
  });

  it("23次の申請期間中なら23次を返す", () => {
    const now = new Date("2026-04-20T00:00:00+09:00");
    expect(findOpenRound(monozukuri, now)?.label).toBe("23次締切");
  });
});
