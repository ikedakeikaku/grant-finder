import { describe, expect, it } from "vitest";
import { isApplicationOffering } from "./offering";

describe("isApplicationOffering", () => {
  it("交付申請等は除外", () => {
    expect(
      isApplicationOffering("[第十回] 事業再構築補助金（交付申請等）"),
    ).toBe(false);
  });
  it("共同申請者は除外", () => {
    expect(
      isApplicationOffering("[第六回以降] 事業再構築補助金（共同申請者）"),
    ).toBe(false);
  });
  it("実績報告・変更申請は除外", () => {
    expect(isApplicationOffering("○○補助金 実績報告")).toBe(false);
    expect(isApplicationOffering("○○補助金 変更申請")).toBe(false);
  });
  it("通常の新規公募は対象", () => {
    expect(isApplicationOffering("ものづくり・商業・サービス生産性向上促進補助金")).toBe(
      true,
    );
    expect(isApplicationOffering("小規模事業者持続化補助金（第17回）")).toBe(
      true,
    );
  });
});
