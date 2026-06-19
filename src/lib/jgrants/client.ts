import type {
  JGrantsDetail,
  JGrantsDetailResponse,
  JGrantsListItem,
  JGrantsListResponse,
  ListSubsidiesParams,
} from "./types";

const DEFAULT_BASE_URL = "https://api.jgrants-portal.go.jp/exp/v1/public";

export interface JGrantsClientOptions {
  baseUrl?: string;
  /** リクエストごとのタイムアウト(ms) */
  timeoutMs?: number;
  /** 失敗時の最大リトライ回数 */
  maxRetries?: number;
}

export class JGrantsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "JGrantsError";
  }
}

/**
 * jGrants 公開APIクライアント（認証不要）。
 * 一時的な失敗には指数バックオフでリトライする。
 */
export class JGrantsClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(options: JGrantsClientOptions = {}) {
    this.baseUrl = (
      options.baseUrl ??
      process.env.JGRANTS_API_BASE_URL ??
      DEFAULT_BASE_URL
    ).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 3;
  }

  /** 補助金一覧を取得する。keyword は2文字以上必須。 */
  async listSubsidies(params: ListSubsidiesParams): Promise<JGrantsListItem[]> {
    if (params.keyword.length < 2) {
      throw new JGrantsError("keyword は2文字以上が必須です");
    }
    const query = new URLSearchParams({
      keyword: params.keyword,
      sort: params.sort ?? "created_date",
      order: params.order ?? "DESC",
    });
    if (params.acceptance !== undefined) {
      query.set("acceptance", String(params.acceptance));
    }
    const json = await this.fetchJson<JGrantsListResponse>(
      `/subsidies?${query.toString()}`,
    );
    return json.result ?? [];
  }

  /** 補助金詳細を取得する。存在しない場合は null。 */
  async getSubsidyDetail(id: string): Promise<JGrantsDetail | null> {
    const json = await this.fetchJson<JGrantsDetailResponse>(
      `/subsidies/id/${encodeURIComponent(id)}`,
    );
    return json.result?.[0] ?? null;
  }

  private async fetchJson<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(url, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        // 5xx と 429 はリトライ対象、その他の 4xx は即時失敗
        if (res.status >= 500 || res.status === 429) {
          throw new JGrantsError(`jGrants ${res.status}`, res.status);
        }
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new JGrantsError(
            `jGrants ${res.status}: ${body.slice(0, 200)}`,
            res.status,
          );
        }
        return (await res.json()) as T;
      } catch (err) {
        lastError = err;
        // リトライ不可能な 4xx はそのまま投げる
        if (
          err instanceof JGrantsError &&
          err.status !== undefined &&
          err.status < 500 &&
          err.status !== 429
        ) {
          throw err;
        }
        if (attempt < this.maxRetries) {
          await sleep(backoffMs(attempt));
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new JGrantsError("jGrants リクエストに失敗しました");
  }
}

/** 指数バックオフ(ms): 500, 1000, 2000, ... */
export function backoffMs(attempt: number): number {
  return 500 * 2 ** attempt;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
