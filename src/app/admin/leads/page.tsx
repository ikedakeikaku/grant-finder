import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isAdminEmail } from "@/lib/admin/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signOut } from "@/app/auth/actions";
import { approveLead, reviewLead, suspendLead } from "./actions";

export const dynamic = "force-dynamic";

type LeadStatus = "pending_review" | "approved" | "suspended";

interface LeadRow {
  id: string;
  name: string | null;
  notify_email: string | null;
  notifications_enabled: boolean | null;
  industry: string | null;
  prefecture: string | null;
  city: string | null;
  employee_count: number | null;
  annual_revenue: number | null;
  purposes: string[] | null;
  interests: string[] | null;
  planned_investment: string | null;
  proposal_status: string | null;
  lead_status: LeadStatus | null;
  approved_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

const statusOrder: Record<LeadStatus, number> = {
  pending_review: 0,
  approved: 1,
  suspended: 2,
};

const statusLabels: Record<LeadStatus, string> = {
  pending_review: "確認待ち",
  approved: "承認済み",
  suspended: "停止中",
};

async function requireAdminEmail(): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) notFound();
  return user.email ?? "";
}

async function fetchLeads(): Promise<LeadRow[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("businesses")
    .select(
      "id, name, notify_email, notifications_enabled, industry, prefecture, city, employee_count, annual_revenue, purposes, interests, planned_investment, proposal_status, lead_status, approved_at, created_at, updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw new Error("リード一覧の取得に失敗しました");

  return ((data ?? []) as LeadRow[]).sort((a, b) => {
    const aStatus = a.lead_status ?? "pending_review";
    const bStatus = b.lead_status ?? "pending_review";
    return statusOrder[aStatus] - statusOrder[bStatus];
  });
}

function statusClass(status: LeadStatus): string {
  if (status === "approved")
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "suspended") return "border-red-200 bg-red-50 text-red-700";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(date);
}

// annual_revenue は DB 上すでに「万円」単位（年商(万円)）なので割らずにそのまま表示する。
function formatMan(man: number | null): string {
  if (man == null) return "-";
  return `${man.toLocaleString("ja-JP")}万円`;
}

function joinTags(values: string[] | null): string {
  return values?.filter(Boolean).join("、") || "-";
}

function actionButtonClass(tone: "primary" | "neutral" | "danger"): string {
  if (tone === "primary") return "bg-black text-white hover:bg-gray-800";
  if (tone === "danger")
    return "border border-red-200 text-red-700 hover:bg-red-50";
  return "border border-gray-300 text-gray-700 hover:bg-gray-50";
}

function LeadActions({ lead }: { lead: LeadRow }) {
  const status = lead.lead_status ?? "pending_review";
  return (
    <div className="flex flex-wrap gap-2">
      {status !== "approved" && (
        <form action={approveLead}>
          <input type="hidden" name="businessId" value={lead.id} />
          <button
            type="submit"
            className={`rounded-md px-3 py-1.5 text-sm ${actionButtonClass("primary")}`}
          >
            承認
          </button>
        </form>
      )}
      {status !== "pending_review" && (
        <form action={reviewLead}>
          <input type="hidden" name="businessId" value={lead.id} />
          <button
            type="submit"
            className={`rounded-md px-3 py-1.5 text-sm ${actionButtonClass("neutral")}`}
          >
            確認待ちへ戻す
          </button>
        </form>
      )}
      {status !== "suspended" && (
        <form action={suspendLead}>
          <input type="hidden" name="businessId" value={lead.id} />
          <button
            type="submit"
            className={`rounded-md px-3 py-1.5 text-sm ${actionButtonClass("danger")}`}
          >
            停止
          </button>
        </form>
      )}
    </div>
  );
}

export default async function AdminLeadsPage() {
  const adminEmail = await requireAdminEmail();
  const leads = await fetchLeads();
  const pendingCount = leads.filter(
    (lead) => (lead.lead_status ?? "pending_review") === "pending_review",
  ).length;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold">リード承認</h1>
          <p className="mt-1 text-sm text-gray-600">
            確認待ち {pendingCount} 件 / 表示 {leads.length} 件
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-500">{adminEmail}</span>
          <Link href="/dashboard" className="text-blue-700 underline">
            ダッシュボード
          </Link>
          <form action={signOut}>
            <button type="submit" className="text-gray-500 underline">
              ログアウト
            </button>
          </form>
        </div>
      </header>

      <p className="mt-5 text-sm text-gray-600">
        承認すると提案生成・通知の対象になります。実際の提案生成は次回バッチまたは手動実行で行われます。
      </p>

      <div className="mt-5 overflow-x-auto border border-gray-200">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="border-b border-gray-200 px-4 py-3">状態</th>
              <th className="border-b border-gray-200 px-4 py-3">事業者</th>
              <th className="border-b border-gray-200 px-4 py-3">条件</th>
              <th className="border-b border-gray-200 px-4 py-3">登録</th>
              <th className="border-b border-gray-200 px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => {
              const status = lead.lead_status ?? "pending_review";
              return (
                <tr key={lead.id} className="align-top">
                  <td className="border-b border-gray-100 px-4 py-4">
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusClass(status)}`}
                    >
                      {statusLabels[status]}
                    </span>
                    <p className="mt-2 text-xs text-gray-500">
                      提案: {lead.proposal_status ?? "-"}
                    </p>
                  </td>
                  <td className="border-b border-gray-100 px-4 py-4">
                    <p className="font-medium">{lead.name ?? "名称未設定"}</p>
                    <p className="mt-1 text-gray-600">
                      {lead.notify_email ?? "通知先未設定"}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      通知: {lead.notifications_enabled ? "有効" : "無効"}
                    </p>
                  </td>
                  <td className="max-w-md border-b border-gray-100 px-4 py-4 text-gray-700">
                    <p>
                      {lead.prefecture ?? "-"} {lead.city ?? ""}
                    </p>
                    <p className="mt-1">
                      {lead.industry ?? "-"} / 従業員{" "}
                      {lead.employee_count?.toLocaleString("ja-JP") ?? "-"}人
                    </p>
                    <p className="mt-1">
                      年商 {formatMan(lead.annual_revenue)}
                    </p>
                    <p className="mt-1">
                      投資予定 {lead.planned_investment?.trim() || "-"}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      目的: {joinTags(lead.purposes)}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      関心: {joinTags(lead.interests)}
                    </p>
                  </td>
                  <td className="border-b border-gray-100 px-4 py-4 text-gray-600">
                    <p>登録: {formatDate(lead.created_at)}</p>
                    <p className="mt-1">更新: {formatDate(lead.updated_at)}</p>
                    <p className="mt-1">承認: {formatDate(lead.approved_at)}</p>
                  </td>
                  <td className="border-b border-gray-100 px-4 py-4">
                    <LeadActions lead={lead} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {leads.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-500">
            登録済みリードはまだありません。
          </div>
        )}
      </div>
    </main>
  );
}
