import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ProfileForm, type BusinessDefaults } from "./ProfileForm";

export default async function ProfilePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: business } = await supabase
    .from("businesses")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">事業情報の登録</h1>
        {business && (
          <Link href="/dashboard" className="text-sm text-blue-700 underline">
            提案を見る →
          </Link>
        )}
      </div>
      <p className="mt-1 text-sm text-gray-600">
        登録内容をもとに、合いそうな補助金を提案し、公募が近づいたらメールでお知らせします。
      </p>
      <div className="mt-8">
        <ProfileForm
          defaults={business as BusinessDefaults | null}
          email={user.email ?? ""}
        />
      </div>
    </main>
  );
}
