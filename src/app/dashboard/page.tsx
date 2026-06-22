import Link from "next/link";
import { redirect } from "next/navigation";
import { differenceInCalendarDays } from "date-fns";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatJst } from "@/lib/notifications/render";
import { safeHttpUrl } from "@/lib/url";
import { overlapsAnyName } from "@/lib/core/dedupe";
import { signOut } from "../auth/actions";

/** ダッシュボードで表示する受付中・予測の各上限（少数精鋭にする）。 */
const DISPLAY_MATCH_LIMIT = 5;
const DISPLAY_PREDICTED_LIMIT = 5;

interface MatchRow {
  id: string;
  score: number;
  reasons: string[] | null;
  subsidies: {
    id: string;
    title: string;
    catch_phrase: string | null;
    subsidy_max_limit: number | null;
    subsidy_rate: string | null;
    acceptance_end_datetime: string | null;
    status: string;
    front_subsidy_detail_page_url: string | null;
  } | null;
}

interface PredictedRow {
  id: string;
  reasons: string[] | null;
  subsidy_predictions: {
    name: string;
    predicted_start_from: string | null;
    basis: string | null;
  } | null;
}

interface ProposalItemRow {
  programId: string;
  name: string;
  fitReason: string;
  usability: string;
  prepare: string[];
  scheduleNote: string;
  deadline?: string | null;
  subsidyMax: number | null;
  subsidyRate: string | null;
  officialUrl: string | null;
  status: string | null;
  isLargeAmount: boolean;
  isStartup: boolean;
}

function formatMan(yen: number | null): string {
  if (yen == null) return "—";
  return `${Math.round(yen / 10000).toLocaleString("ja-JP")}万円`;
}

/** 提案制度の締切表示。日付として解釈できれば残り日数も返す（自由記述はそのまま）。 */
function proposalDeadline(
  deadline: string | null | undefined,
  now: Date,
): { label: string; daysLeft: number | null } | null {
  const raw = deadline?.trim();
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return { label: raw, daysLeft: null };
  return { label: formatJst(d), daysLeft: differenceInCalendarDays(d, now) };
}

function itemTags(it: ProposalItemRow): string[] {
  const t: string[] = [];
  if (it.isLargeAmount) t.push("大型");
  if (it.isStartup) t.push("創業");
  return t;
}

function predictedMonth(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getUTCMonth() + 1}月頃`;
}

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: business } = await supabase
    .from("businesses")
    .select(
      "id, name, proposal_status, lead_status, industry, prefecture, city, description, employee_count, annual_revenue, founded_year",
    )
    .eq("user_id", user.id)
    .maybeSingle();
  if (!business) redirect("/profile");
  const leadStatus =
    (business.lead_status as string | null) ?? "pending_review";

  if (leadStatus !== "approved") {
    const message =
      leadStatus === "suspended"
        ? "現在、このアカウントの提案生成と通知は停止されています。確認が必要な場合はお問い合わせください。"
        : "登録内容を受け付けました。確認後に提案書を作成し、メールでお知らせします。";
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{business.name} さんへの提案</h1>
            <p className="mt-1 text-sm text-gray-600">ステータス確認中</p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Link href="/profile" className="text-blue-700 underline">
              条件を編集
            </Link>
            <form action={signOut}>
              <button type="submit" className="text-gray-500 underline">
                ログアウト
              </button>
            </form>
          </div>
        </header>
        <section className="mt-8 rounded-lg border border-gray-200 bg-gray-50 p-6 text-sm text-gray-700">
          {message}
        </section>
      </main>
    );
  }

  // 調査済みの提案書（制度マスタベース）
  const { data: proposalData } = await supabase
    .from("proposals")
    .select("summary, items, generated_at")
    .eq("business_id", business.id)
    .maybeSingle();
  const proposal = proposalData as {
    summary: string | null;
    items: ProposalItemRow[] | null;
    generated_at: string | null;
  } | null;
  const proposalItems = (proposal?.items ?? []).filter(Boolean);

  const { data } = await supabase
    .from("matches")
    .select(
      "id, score, reasons, subsidies(id, title, catch_phrase, subsidy_max_limit, subsidy_rate, acceptance_end_datetime, status, front_subsidy_detail_page_url)",
    )
    .eq("business_id", business.id)
    .eq("kind", "open")
    .eq("dismissed", false)
    .order("score", { ascending: false });
  const matches = (data ?? []) as unknown as MatchRow[];

  // 公募前予測（例年そろそろ公募が始まる制度）
  const { data: predData } = await supabase
    .from("matches")
    .select(
      "id, reasons, subsidy_predictions(name, predicted_start_from, basis)",
    )
    .eq("business_id", business.id)
    .eq("kind", "predicted")
    .eq("dismissed", false)
    .order("score", { ascending: false });
  const predicted = (predData ?? []) as unknown as PredictedRow[];

  const now = new Date();

  // 重複・低品質を抑えて少数精鋭に絞る。
  //  - 提案書（🎯）に既出の制度は📨📅から除外
  //  - 補助上限0円（利子補給など実質ローン）は除外
  //  - 締切超過は除外、各セクション上限で打ち切り
  const proposalNames = proposalItems.map((it) => it.name);
  const visibleMatches = matches
    .filter((m) => {
      const s = m.subsidies;
      if (!s) return false;
      if (s.subsidy_max_limit === 0) return false;
      if (s.acceptance_end_datetime) {
        const end = new Date(s.acceptance_end_datetime);
        if (differenceInCalendarDays(end, now) < 0) return false;
      }
      return !overlapsAnyName(s.title, proposalNames);
    })
    .slice(0, DISPLAY_MATCH_LIMIT);
  const visibleMatchTitles = visibleMatches
    .map((m) => m.subsidies?.title)
    .filter((t): t is string => Boolean(t));
  const visiblePredicted = predicted
    .filter((p) => {
      const pred = p.subsidy_predictions;
      if (!pred) return false;
      if (overlapsAnyName(pred.name, proposalNames)) return false;
      return !overlapsAnyName(pred.name, visibleMatchTitles);
    })
    .slice(0, DISPLAY_PREDICTED_LIMIT);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{business.name} さんへの提案</h1>
          <p className="mt-1 text-sm text-gray-600">
            登録条件に合う補助金 {visibleMatches.length} 件
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/profile" className="text-blue-700 underline">
            条件を編集
          </Link>
          <form action={signOut}>
            <button type="submit" className="text-gray-500 underline">
              ログアウト
            </button>
          </form>
        </div>
      </header>

      <section className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <span>
            所在地：
            {[
              business.prefecture as string | null,
              business.city as string | null,
            ]
              .filter(Boolean)
              .join(" ") || "—"}
          </span>
          <span>業種：{(business.industry as string | null) ?? "—"}</span>
          <span>
            従業員：
            {business.employee_count != null
              ? `${business.employee_count}人`
              : "—"}
          </span>
          <span>
            年商：
            {business.annual_revenue != null
              ? `${Number(business.annual_revenue).toLocaleString("ja-JP")}万円`
              : "—"}
          </span>
          <span>
            設立：
            {business.founded_year ? `${business.founded_year}年` : "—"}
          </span>
        </div>
        {(business.description as string | null)?.trim() && (
          <p className="mt-2">事業内容：{business.description as string}</p>
        )}
        <p className="mt-2 text-xs">
          <Link href="/profile" className="text-blue-700 underline">
            登録情報を編集
          </Link>
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">🎯 あなたへの補助金提案書</h2>
        {proposalItems.length === 0 ? (
          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-6 text-sm text-gray-600">
            {business.proposal_status === "ready"
              ? "現時点で特におすすめできる制度が見つかりませんでした。条件の見直しでより多くの提案が得られる場合があります。"
              : "提案書を準備中です。調査が完了するとここに表示され、メールでもお届けします。"}
          </div>
        ) : (
          <>
            {proposal?.summary && (
              <p className="mt-2 text-sm text-gray-700">{proposal.summary}</p>
            )}
            <ul className="mt-4 space-y-4">
              {proposalItems.map((it) => {
                const url = safeHttpUrl(it.officialUrl);
                const money = [
                  `補助上限 ${formatMan(it.subsidyMax)}`,
                  ...(it.subsidyRate ? [`補助率 ${it.subsidyRate}`] : []),
                ].join(" / ");
                const dl = proposalDeadline(it.deadline, now);
                return (
                  <li
                    key={it.programId}
                    className="rounded-lg border border-emerald-200 bg-emerald-50/30 p-5 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-semibold leading-snug">
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-emerald-900 hover:underline"
                          >
                            {it.name}
                          </a>
                        ) : (
                          it.name
                        )}
                      </h3>
                      <div className="flex shrink-0 gap-1">
                        {itemTags(it).map((t) => (
                          <span
                            key={t}
                            className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-700"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                    <p className="mt-1 text-sm text-gray-600">{money}</p>
                    {dl && (
                      <p className="mt-2 text-sm">
                        <span className="text-gray-500">締切：</span>
                        {dl.label}
                        {dl.daysLeft != null && dl.daysLeft >= 0 && (
                          <span
                            className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                              dl.daysLeft <= 7
                                ? "bg-red-100 text-red-700"
                                : dl.daysLeft <= 30
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-gray-100 text-gray-600"
                            }`}
                          >
                            残り{dl.daysLeft}日
                          </span>
                        )}
                      </p>
                    )}
                    {it.scheduleNote && (
                      <p className="mt-2 text-sm">
                        <span className="text-gray-500">時期：</span>
                        {it.scheduleNote}
                      </p>
                    )}
                    {it.fitReason && (
                      <p className="mt-1 text-sm">
                        <span className="text-gray-500">合う理由：</span>
                        {it.fitReason}
                      </p>
                    )}
                    {it.usability && (
                      <p className="mt-1 text-sm">
                        <span className="text-gray-500">使えるか：</span>
                        {it.usability}
                      </p>
                    )}
                    {it.prepare && it.prepare.length > 0 && (
                      <p className="mt-1 text-sm">
                        <span className="text-gray-500">ご準備：</span>
                        {it.prepare.join("、")}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-xs text-gray-500">
              公募が近づいた制度はメールでお知らせします。申請のご相談も承っています。
            </p>
          </>
        )}
      </section>

      <h2 className="mt-12 text-lg font-bold">📨 現在受付中（Jグランツ）</h2>
      {visibleMatches.length === 0 ? (
        <div className="mt-10 rounded-lg border border-gray-200 bg-gray-50 p-6 text-sm text-gray-600">
          現在受付中で条件に合う補助金は見つかりませんでした。
          公募が始まったらメールでお知らせします。条件の見直しは
          <Link href="/profile" className="text-blue-700 underline">
            こちら
          </Link>
          。
        </div>
      ) : (
        <ul className="mt-8 space-y-4">
          {visibleMatches.map((m) => {
            const s = m.subsidies;
            if (!s) return null;
            const end = s.acceptance_end_datetime
              ? new Date(s.acceptance_end_datetime)
              : null;
            const daysLeft = end ? differenceInCalendarDays(end, now) : null;
            // 締切を過ぎた提案は表示しない（鮮度ガード）。
            if (daysLeft != null && daysLeft < 0) return null;
            const detailUrl = safeHttpUrl(s.front_subsidy_detail_page_url);
            return (
              <li
                key={m.id}
                className="rounded-lg border border-gray-200 p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <h2 className="font-semibold leading-snug">
                    {detailUrl ? (
                      <a
                        href={detailUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-800 hover:underline"
                      >
                        {s.title}
                      </a>
                    ) : (
                      s.title
                    )}
                  </h2>
                  {daysLeft != null && daysLeft >= 0 && (
                    <span
                      className={`shrink-0 rounded-full px-2 py-1 text-xs ${
                        daysLeft <= 7
                          ? "bg-red-100 text-red-700"
                          : daysLeft <= 30
                            ? "bg-amber-100 text-amber-700"
                            : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      締切まで{daysLeft}日
                    </span>
                  )}
                </div>
                {s.catch_phrase && (
                  <p className="mt-1 text-sm text-gray-600">{s.catch_phrase}</p>
                )}
                <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-700">
                  <div>
                    <dt className="inline text-gray-500">補助上限：</dt>
                    <dd className="inline">{formatMan(s.subsidy_max_limit)}</dd>
                  </div>
                  {s.subsidy_rate && (
                    <div>
                      <dt className="inline text-gray-500">補助率：</dt>
                      <dd className="inline">{s.subsidy_rate}</dd>
                    </div>
                  )}
                  {end && (
                    <div>
                      <dt className="inline text-gray-500">締切：</dt>
                      <dd className="inline">{formatJst(end)}</dd>
                    </div>
                  )}
                </dl>
                {m.reasons && m.reasons.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {m.reasons.map((r, i) => (
                      <span
                        key={i}
                        className="rounded bg-green-50 px-2 py-0.5 text-xs text-green-800"
                      >
                        {r}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {visiblePredicted.length > 0 && (
        <section className="mt-12">
          <h2 className="text-lg font-bold">
            📅 例年そろそろ公募が予想される補助金
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            過去の公募実績から、まもなく募集が始まると予測される制度です。公募開始が近づいたらお知らせします。
          </p>
          <ul className="mt-4 space-y-3">
            {visiblePredicted.map((p) => {
              const pred = p.subsidy_predictions;
              if (!pred) return null;
              return (
                <li
                  key={p.id}
                  className="rounded-lg border border-dashed border-amber-300 bg-amber-50/40 p-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <h3 className="font-semibold leading-snug">{pred.name}</h3>
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-800">
                      例年{predictedMonth(pred.predicted_start_from)}
                    </span>
                  </div>
                  {pred.basis && (
                    <p className="mt-1 text-sm text-gray-600">{pred.basis}</p>
                  )}
                  {p.reasons && p.reasons.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {p.reasons.map((r, i) => (
                        <span
                          key={i}
                          className="rounded bg-amber-100/70 px-2 py-0.5 text-xs text-amber-900"
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <p className="mt-10 text-xs text-gray-400">
        出典：Jグランツポータル（https://www.jgrants-portal.go.jp）
      </p>
    </main>
  );
}
