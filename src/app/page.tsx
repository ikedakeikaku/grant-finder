import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto flex max-w-3xl flex-1 flex-col justify-center px-6 py-16">
      <h1 className="text-3xl font-bold leading-tight sm:text-4xl">
        あなたの事業に合う補助金を、
        <br />
        公募が始まる前にお知らせ。
      </h1>
      <p className="mt-5 max-w-xl text-gray-600">
        事業情報と関心分野を登録するだけ。その年の有望な補助金を提案し、
        公募の締切が近づいたらメールでお知らせします。公募期間は短く見逃しがち
        ——「気づけなかった」をなくします。
      </p>

      <div className="mt-8 flex gap-3">
        <Link
          href={user ? "/dashboard" : "/login"}
          className="rounded-md bg-black px-6 py-3 text-white"
        >
          {user ? "提案を見る" : "無料ではじめる"}
        </Link>
        {!user && (
          <Link
            href="/login"
            className="rounded-md border border-gray-300 px-6 py-3"
          >
            ログイン
          </Link>
        )}
      </div>

      <ul className="mt-12 grid gap-4 sm:grid-cols-3">
        {[
          ["登録はかんたん", "事業情報と関心分野を選ぶだけ"],
          ["公募前に予告", "例年パターンと予算動向から先回り"],
          ["締切をリマインド", "30/14/7日前にメールでお知らせ"],
        ].map(([t, d]) => (
          <li key={t} className="rounded-lg border border-gray-200 p-4">
            <p className="font-semibold">{t}</p>
            <p className="mt-1 text-sm text-gray-600">{d}</p>
          </li>
        ))}
      </ul>

      <p className="mt-12 text-xs text-gray-400">
        出典：Jグランツポータル（https://www.jgrants-portal.go.jp）
      </p>
    </main>
  );
}
