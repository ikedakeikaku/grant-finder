import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEmailSender,
  DryRunEmailSender,
  maskEmailForLog,
  ResendEmailSender,
} from "./mailer";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("createEmailSender", () => {
  it("RESEND_API_KEY 未設定なら dry-run sender を返す", () => {
    expect(createEmailSender()).toBeInstanceOf(DryRunEmailSender);
  });

  it("実送信では NOTIFY_FROM_EMAIL を必須にする", () => {
    vi.stubEnv("RESEND_API_KEY", "dummy");
    expect(() => createEmailSender()).toThrow("NOTIFY_FROM_EMAIL");
  });

  it("実送信の設定が揃っていれば Resend sender を返す", () => {
    vi.stubEnv("RESEND_API_KEY", "dummy");
    vi.stubEnv("NOTIFY_FROM_EMAIL", "Grant Finder <notify@example.com>");
    expect(createEmailSender()).toBeInstanceOf(ResendEmailSender);
  });
});

describe("DryRunEmailSender", () => {
  it("dry-run ログに宛先メールアドレスをそのまま出さない", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await new DryRunEmailSender().send({
      to: "owner@example.com",
      subject: "件名",
      text: "",
      html: "",
    });

    expect(log).toHaveBeenCalledWith(expect.not.stringContaining("owner@"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("o***@"));
  });
});

describe("ResendEmailSender", () => {
  it("失敗レスポンスのメールアドレスをマスクする", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        text: async () => "invalid recipient owner@example.com",
      })),
    );

    const result = await new ResendEmailSender(
      "dummy",
      "Grant Finder <notify@example.com>",
    ).send({
      to: "owner@example.com",
      subject: "件名",
      text: "",
      html: "",
    });

    expect(result.ok).toBe(false);
    expect(result.error).not.toContain("owner@example.com");
    expect(result.error).toContain("o***@example.com");
  });
});

describe("maskEmailForLog", () => {
  it("メールアドレスのローカル部をマスクする", () => {
    expect(maskEmailForLog("owner@example.com")).toBe("o***@example.com");
  });
});
