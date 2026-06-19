# jGrants 公開API メモ

デジタル庁が提供する補助金電子申請システムの公開API。**認証不要**で利用規約の範囲で使える。
出典表示が必要（「Jグランツポータル」 https://www.jgrants-portal.go.jp ）。

- 開発者ドキュメント: https://developers.digital.go.jp/documents/jgrants/api/
- 公開API案内: https://www.jgrants-portal.go.jp/open-api

## エンドポイント

ベース: `https://api.jgrants-portal.go.jp/exp`

| 用途 | メソッド | パス |
| --- | --- | --- |
| 補助金一覧取得 | GET | `/v1/public/subsidies` |
| 補助金詳細取得 | GET | `/v1/public/subsidies/id/{id}` |
| 補助金詳細取得 V2 | GET | `/v2/public/subsidies/id/{id}` |

## 一覧取得の主なクエリ

- `keyword`（**2文字以上必須**）でキーワード検索。複数キーワードは個別呼び出しで集約する。
- `sort` / `order` / `acceptance`（受付中フィルタ）などの絞り込みがある。
- レスポンスは `{ metadata, result: [...] }`。`result` の各要素が補助金。

## 取り込み方針

- `JGRANTS_INGEST_KEYWORDS`（カンマ区切り）の各語で一覧を引き、ID で名寄せして `subsidies` に upsert。
- 詳細（本文・対象・経費など）は詳細APIで補完。`raw` に元レスポンス全体を保存し将来の項目追加に備える。
- `schedule_key`（回次・年度を除いた制度の同一性キー）で `subsidy_schedules` に履歴を蓄積 → 予測の学習元。
- レート制限は明記がないため、呼び出し間隔を空け、失敗時はリトライ/バックオフする。

## 実装

- クライアント: `src/lib/jgrants/client.ts`、型: `types.ts`、正規化: `normalize.ts`
- 取込スクリプト: `scripts/ingest-jgrants.ts`（cron）
- 実レスポンスでの契約テストを必ず1件通すこと（型不一致の早期検出）。
