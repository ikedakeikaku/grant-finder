import { z } from "zod";
import {
  INDUSTRY_OPTIONS,
  PREFECTURES,
  PURPOSE_OPTIONS,
} from "@/lib/core/constants";

/**
 * 事業者プロフィール入力のバリデーション（登録フォーム）。
 * FormData からの文字列を解釈して型付きの入力に変換する。
 */

const currentYear = new Date().getFullYear();

const employeeCountFromForm = z.preprocess(
  (v) => (v === "" || v == null ? null : Number(v)),
  z.number().int().nonnegative().max(100_000).nullable(),
);

const annualRevenueFromForm = z.preprocess(
  (v) => (v === "" || v == null ? null : Number(v)),
  z.number().int().nonnegative().max(1_000_000_000).nullable(),
);

const foundedYearFromForm = z.preprocess(
  (v) => (v === "" || v == null ? null : Number(v)),
  z
    .number()
    .int()
    .min(1800)
    .max(currentYear + 1)
    .nullable(),
);

const nullableIndustry = z.union([z.literal(null), z.enum(INDUSTRY_OPTIONS)]);
const nullablePrefecture = z.union([z.literal(null), z.enum(PREFECTURES)]);
const nullableText = (max: number) =>
  z.union([z.literal(null), z.string().trim().max(max)]);

const tagSchema = z.string().trim().min(1).max(40);
const notifyEmailSchema = z.union([
  z.literal(null),
  z.string().trim().email("メールアドレスの形式が不正です").max(254),
]);

export const loginSchema = z.object({
  email: z.string().trim().email("メールアドレスの形式が不正です").max(254),
});

export const profileSchema = z.object({
  name: z.string().trim().min(1, "会社名を入力してください").max(200),
  industry: nullableIndustry,
  prefecture: nullablePrefecture,
  city: nullableText(100),
  description: nullableText(2000),
  employeeCount: employeeCountFromForm,
  annualRevenue: annualRevenueFromForm,
  foundedYear: foundedYearFromForm,
  purposes: z
    .array(z.enum(PURPOSE_OPTIONS))
    .max(PURPOSE_OPTIONS.length)
    .transform(unique),
  interests: z.array(tagSchema).max(20).transform(unique),
  plannedInvestment: nullableText(1000),
  notifyEmail: notifyEmailSchema,
  notificationsEnabled: z.boolean(),
});

export type ProfileInput = z.infer<typeof profileSchema>;

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function emptyToNull(s: string): string | null {
  return s.length === 0 ? null : s;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function parseLoginForm(formData: FormData) {
  return loginSchema.safeParse({
    email: str(formData.get("email")),
  });
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
    description: emptyToNull(str(formData.get("description"))),
    employeeCount: str(formData.get("employeeCount")),
    annualRevenue: str(formData.get("annualRevenue")),
    foundedYear: str(formData.get("foundedYear")),
    purposes: formData.getAll("purposes").map((v) => String(v).trim()),
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
    description: input.description,
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
