import { afterEach, describe, expect, it } from "vitest";
import { buildAppUrl, safeHttpUrl, safeRelativePath } from "./url";

const originalAppBaseUrl = process.env.APP_BASE_URL;

afterEach(() => {
  process.env.APP_BASE_URL = originalAppBaseUrl;
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
    process.env.APP_BASE_URL = "https://app.example.com/";
    expect(buildAppUrl("/dashboard")).toBe("https://app.example.com/dashboard");
  });
});
