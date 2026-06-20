const DEFAULT_APP_BASE_URL = "http://localhost:3000";
const LOCAL_URL_ORIGIN = "https://app.local";

export function safeHttpUrl(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw || raw.length > 2048 || /[\u0000-\u001f\u007f]/.test(raw)) {
    return null;
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function safeRelativePath(
  value: string | null | undefined,
  fallback = "/dashboard",
): string {
  const raw = value?.trim();
  if (
    !raw ||
    raw.length > 1024 ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    raw.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(raw)
  ) {
    return fallback;
  }

  try {
    const url = new URL(raw, LOCAL_URL_ORIGIN);
    if (url.origin !== LOCAL_URL_ORIGIN) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function getAppBaseUrl(fallback?: string | null): string {
  const configured = safeHttpUrl(process.env.APP_BASE_URL);
  if (configured) return stripTrailingSlash(configured);

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "APP_BASE_URL には https://... の本番URLを設定してください",
    );
  }

  return stripTrailingSlash(safeHttpUrl(fallback) ?? DEFAULT_APP_BASE_URL);
}

export function buildAppUrl(
  path: string,
  fallbackBase?: string | null,
): string {
  return new URL(
    safeRelativePath(path, "/"),
    `${getAppBaseUrl(fallbackBase)}/`,
  ).toString();
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
