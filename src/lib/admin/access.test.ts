import { afterEach, describe, expect, it } from "vitest";
import { adminEmails, isAdminEmail } from "./access";

const originalAdminEmails = process.env.ADMIN_EMAILS;

afterEach(() => {
  if (originalAdminEmails === undefined) {
    delete process.env.ADMIN_EMAILS;
  } else {
    process.env.ADMIN_EMAILS = originalAdminEmails;
  }
});

describe("admin access", () => {
  it("ADMIN_EMAILS を小文字化してカンマ区切りで読む", () => {
    process.env.ADMIN_EMAILS = " Owner@example.com,admin@example.com ";

    expect(adminEmails()).toEqual(["owner@example.com", "admin@example.com"]);
  });

  it("大文字小文字と前後空白を無視して管理者メールを判定する", () => {
    process.env.ADMIN_EMAILS = "owner@example.com";

    expect(isAdminEmail(" Owner@Example.com ")).toBe(true);
    expect(isAdminEmail("user@example.com")).toBe(false);
  });

  it("未設定なら誰も管理者扱いにしない", () => {
    delete process.env.ADMIN_EMAILS;

    expect(adminEmails()).toEqual([]);
    expect(isAdminEmail("owner@example.com")).toBe(false);
  });
});
