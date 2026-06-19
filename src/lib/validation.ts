import { z } from "zod";

/**
 * 事業者プロフィール入力のバリデーション（登録フォーム）。
 * FormData からの文字列を解釈して型付きの入力に変換する。
 */

const numberFromForm = z.preprocess(
  (v) => (v === "" || v == null ? null : Number(v)),
  z.number().int().nonnegative().nullable(),
);

export const profileSchema = z.object({
  name: z.string().trim().min(1, "会社名を入力してください").max(200),
  industry: z.string().nullable(),
  prefecture: z.string().nullable(),
  city: z.string().nullable(),
  employeeCount: numberFromForm,
  annualRevenue: numberFromForm,
  foundedYear: numberFromForm,
  purposes: z.array(z.string()),
  interests: z.array(z.string()),
  plannedInvestment: z.string().nullable(),
  notifyEmail: z
    .union([
      z.literal(null),
      z.string().email("メールアドレスの形式が不正です"),
    ])
    .nullable(),
  notificationsEnabled: z.boolean(),
});

export type ProfileInput = z.infer<typeof profileSchema>;

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function emptyToNull(s: string): string | null {
  return s.length === 0 ? null : s;
}

/** 「省力化, DX 輸出」のような自由入力をタグ配列に分解する。 */
export function splitTags(s: string): string[] {
  return s
    .split(/[,、\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/** 登録フォームの FormData を検証して ProfileInput を返す。 */
export function parseProfileForm(formData: FormData) {
  const raw = {
    name: str(formData.get("name")),
    industry: emptyToNull(str(formData.get("industry"))),
    prefecture: emptyToNull(str(formData.get("prefecture"))),
    city: emptyToNull(str(formData.get("city"))),
    employeeCount: str(formData.get("employeeCount")),
    annualRevenue: str(formData.get("annualRevenue")),
    foundedYear: str(formData.get("foundedYear")),
    purposes: formData.getAll("purposes").map((v) => String(v)),
    interests: splitTags(str(formData.get("interests"))),
    plannedInvestment: emptyToNull(str(formData.get("plannedInvestment"))),
    notifyEmail: emptyToNull(str(formData.get("notifyEmail"))),
    notificationsEnabled: formData.get("notificationsEnabled") != null,
  };
  return profileSchema.safeParse(raw);
}

/** ProfileInput を businesses テーブルの行（snake_case）に変換する。 */
export function toBusinessRow(input: ProfileInput, userId: string) {
  return {
    user_id: userId,
    name: input.name,
    industry: input.industry,
    prefecture: input.prefecture,
    city: input.city,
    employee_count: input.employeeCount,
    annual_revenue: input.annualRevenue,
    founded_year: input.foundedYear,
    purposes: input.purposes,
    interests: input.interests,
    planned_investment: input.plannedInvestment,
    notify_email: input.notifyEmail,
    notifications_enabled: input.notificationsEnabled,
  };
}
