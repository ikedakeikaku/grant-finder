"use client";

import { useActionState } from "react";
import {
  INDUSTRY_OPTIONS,
  PREFECTURES,
  PURPOSE_OPTIONS,
} from "@/lib/core/constants";
import { saveProfile, type ProfileState } from "./actions";

export interface BusinessDefaults {
  name: string | null;
  industry: string | null;
  prefecture: string | null;
  city: string | null;
  description: string | null;
  employee_count: number | null;
  annual_revenue: number | null;
  founded_year: number | null;
  purposes: string[] | null;
  interests: string[] | null;
  planned_investment: string | null;
  notify_email: string | null;
  notifications_enabled: boolean | null;
}

const initial: ProfileState = {};

export function ProfileForm({
  defaults,
  email,
}: {
  defaults: BusinessDefaults | null;
  email: string;
}) {
  const [state, action, pending] = useActionState(saveProfile, initial);
  const d = defaults;
  const err = state.fieldErrors;

  return (
    <form action={action} className="space-y-6">
      <Field label="会社名 / 屋号" error={err?.name}>
        <input
          name="name"
          required
          defaultValue={d?.name ?? ""}
          className="input"
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="業種">
          <select
            name="industry"
            defaultValue={d?.industry ?? ""}
            className="input"
          >
            <option value="">選択してください</option>
            {INDUSTRY_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </Field>
        <Field label="所在地（都道府県）">
          <select
            name="prefecture"
            defaultValue={d?.prefecture ?? ""}
            className="input"
          >
            <option value="">選択してください</option>
            {PREFECTURES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="所在地（市区町村）">
        <input
          name="city"
          defaultValue={d?.city ?? ""}
          placeholder="例: 横浜市中区"
          className="input"
        />
      </Field>

      <Field label="事業内容（自由記述）">
        <textarea
          name="description"
          defaultValue={d?.description ?? ""}
          rows={3}
          placeholder="例: 自社SaaSの開発・提供、生成AI研修事業 など"
          className="input"
        />
      </Field>

      <div className="grid grid-cols-3 gap-4">
        <Field label="従業員数">
          <input
            name="employeeCount"
            type="number"
            min={0}
            defaultValue={d?.employee_count ?? ""}
            className="input"
          />
        </Field>
        <Field label="年商（万円）">
          <input
            name="annualRevenue"
            type="number"
            min={0}
            defaultValue={d?.annual_revenue ?? ""}
            className="input"
          />
        </Field>
        <Field label="設立年（西暦）">
          <input
            name="foundedYear"
            type="number"
            min={0}
            defaultValue={d?.founded_year ?? ""}
            className="input"
          />
        </Field>
      </div>

      <Field label="やりたいこと・目的（複数選択可）">
        <div className="grid grid-cols-2 gap-2">
          {PURPOSE_OPTIONS.map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="purposes"
                value={p}
                defaultChecked={d?.purposes?.includes(p) ?? false}
              />
              {p}
            </label>
          ))}
        </div>
      </Field>

      <Field label="関心キーワード（カンマ/スペース区切り）">
        <input
          name="interests"
          defaultValue={(d?.interests ?? []).join(", ")}
          placeholder="例: 省力化, DX, 輸出, 設備投資"
          className="input"
        />
      </Field>

      <Field label="検討している投資・取り組み（自由記述）">
        <textarea
          name="plannedInvestment"
          defaultValue={d?.planned_investment ?? ""}
          rows={3}
          className="input"
        />
      </Field>

      <Field label="通知先メールアドレス" error={err?.notifyEmail}>
        <input
          name="notifyEmail"
          type="email"
          defaultValue={d?.notify_email ?? email}
          className="input"
        />
      </Field>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="notificationsEnabled"
          defaultChecked={d?.notifications_enabled ?? true}
        />
        公募の通知メールを受け取る
      </label>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-black px-5 py-2 text-white disabled:opacity-50"
      >
        {pending ? "保存中..." : "保存して提案を見る"}
      </button>
    </form>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string[] | undefined;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium">{label}</label>
      <div className="mt-1">{children}</div>
      {error && error.length > 0 && (
        <p className="mt-1 text-sm text-red-600">{error[0]}</p>
      )}
    </div>
  );
}
