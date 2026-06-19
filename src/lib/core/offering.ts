/**
 * jGrants には新規公募だけでなく、採択後の事務手続き窓口
 * （交付申請・実績報告・変更申請・共同申請者向け 等）も「補助金」として並ぶ。
 * これらは新規に応募できる案件ではないため、提案から除外する。
 */

/** 新規応募できない事務手続き等を示すタイトル/管理番号のパターン */
const NON_OFFERING_PATTERNS = [
  "交付申請",
  "交付申請等",
  "実績報告",
  "事業実績",
  "中間報告",
  "変更申請",
  "変更承認",
  "完了報告",
  "完了後申請",
  "事業完了後",
  "精算",
  "概算払",
  "共同申請者",
  "取下",
  "廃止",
] as const;

/**
 * 「新規に応募できる公募」かどうかを判定する純粋関数。
 * 事務手続き系のタイトルを含むものは false。
 */
export function isApplicationOffering(
  title: string,
  name?: string | null,
): boolean {
  const haystack = `${title} ${name ?? ""}`;
  return !NON_OFFERING_PATTERNS.some((p) => haystack.includes(p));
}
