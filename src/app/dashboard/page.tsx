import Link from "next/link";
import { redirect } from "next/navigation";
import { differenceInCalendarDays } from "date-fns";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatJst } from "@/lib/notifications/render";
import { signOut } from "../auth/actions";

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

function formatMan(yen: number | null): string {
  if (yen == null) return "—";
  return `${Math.round(yen / 10000).toLocaleString("ja-JP")}万円`;
}

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: business } = await supabase
    .from("businesses")
    .select("id, name")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!business) redirect("/profile");

  const { data } = await supabase
    .from("matches")
    .select(
      "id, score, reasons, subsidies(id, title, catch_phrase, subsidy_max_limit, subsidy_rate, acceptance_end_datetime, status, front_subsidy_detail_page_url)",
    )
    .eq("business_id", business.id)
    .eq("dismissed", false)
    .order("score", { ascending: false });
  const matches = (data ?? []) as unknown as MatchRow[];
  const now = new Date();

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{business.name} さんへの提案</h1>
          <p className="mt-1 text-sm text-gray-600">
            登録条件に合う補助金 {matches.length} 件
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

      {matches.length === 0 ? (
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
          {matches.map((m) => {
            const s = m.subsidies;
            if (!s) return null;
            const end = s.acceptance_end_datetime
              ? new Date(s.acceptance_end_datetime)
              : null;
            const daysLeft = end ? differenceInCalendarDays(end, now) : null;
            return (
              <li
                key={m.id}
                className="rounded-lg border border-gray-200 p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <h2 className="font-semibold leading-snug">
                    {s.front_subsidy_detail_page_url ? (
                      <a
                        href={s.front_subsidy_detail_page_url}
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

      <p className="mt-10 text-xs text-gray-400">
        出典：Jグランツポータル（https://www.jgrants-portal.go.jp）
      </p>
    </main>
  );
}
