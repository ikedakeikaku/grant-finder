/**
 * マッチングで使う統制語彙。
 *
 * PURPOSE_OPTIONS は jGrants の `use_purpose` カテゴリに揃えてある。
 * 登録フォームの「目的」選択肢としてそのまま使い、補助金側の use_purpose と
 * 突合できるようにする（表記を一致させることが精度の鍵）。
 */
export const PURPOSE_OPTIONS = [
  "新たな事業を行いたい",
  "販路を広げたい",
  "設備整備・IT導入をしたい",
  "従業員の確保・育成をしたい",
  "事業を引き継ぎたい",
  "研究開発・実証事業を行いたい",
  "環境・エネルギー対策をしたい",
  "資金繰りを改善したい",
] as const;

export type PurposeOption = (typeof PURPOSE_OPTIONS)[number];
