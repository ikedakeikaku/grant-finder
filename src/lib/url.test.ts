import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAppUrl, safeHttpUrl, safeRelativePath } from "./url";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("safeHttpUrl", () => {
  it("http(s)だけを許可する", () => {
    expect(safeHttpUrl("https://example.com/path")).toBe(
      "https://example.com/path",
    );
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,hello")).toBeNull();
  });
});

describe("safeRelativePath", () => {
  it("アプリ内の相対パスだけを許可する", () => {
    expect(safeRelativePath("/dashboard?tab=x")).toBe("/dashboard?tab=x");
    expect(safeRelativePath("https://evil.example")).toBe("/dashboard");
    expect(safeRelativePath("//evil.example/path")).toBe("/dashboard");
    expect(safeRelativePath("/\\evil")).toBe("/dashboard");
  });
});

describe("buildAppUrl", () => {
  it("APP_BASE_URL と安全なパスからURLを作る", () => {
    vi.stubEnv("APP_BASE_URL", "https://app.example.com/");
    expect(buildAppUrl("/dashboard")).toBe("https://app.example.com/dashboard");
  });

  it("production では APP_BASE_URL に https を要求する", () => {
    vi.stubEnv("APP_BASE_URL", "http://app.example.com");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => buildAppUrl("/dashboard")).toThrow("APP_BASE_URL");
  });
});
