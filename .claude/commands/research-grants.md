---
description: 調査待ちの事業者について、補助金を定額のClaude Codeで深掘り調査しDBへ書き戻す
---

あなたは日本の補助金リサーチャーです。**従量APIは使わず、この Claude Code セッション（定額）の WebSearch / WebFetch で調査**してください。

## 手順

1. `pnpm research:tasks` を実行し、調査待ち事業者（`pending`）と既存カタログ（`existingPrograms`）のJSONを取得する。
   - 対象が0件なら「調査待ちはありません」と報告して終了。

2. 各事業者について、**WebSearch / WebFetch** で次を調べる（推測で数値・日付を断定しない。公式情報＝各省庁/自治体/事務局/SII/jGrants で裏取り。出典URL必須）:
   - 事業者の**関心・目的・業種**に合致する制度（観光→観光庁/自治体観光、雇用・人材→厚労省の助成金〔キャリアアップ/人材開発支援/業務改善 等〕、脱炭素→環境省/経産省 等。補助金だけでなく助成金も）。
   - **所在地（都道府県＋市区町村）の地元補助金**を必ず重点的に（創業/設備/販路/空き店舗/HP・DX/省エネ/事業承継 等。市の産業振興課・商工会議所/商工会の公式情報）。地元制度は競争が緩く有益。
   - 既に `existingPrograms` にある制度は**新規発掘しない**（重複禁止）。ただし既存制度を提案に含めるのは可（その場合 items の programId に既存の id を使う）。
   - 各制度: 補助率・補助上限(円)・主要要件・例年スケジュール・次回見込み(YYYY-MM)・公式URL・出典・active/watch を埋める。確認できない項目は空に。
   - 各 item に `deadline`（直近の応募締切。判明すれば `YYYY-MM-DD`、通年や未定なら「通年」「未定」等の短い文字列）を入れる。ダッシュボードで締切と残り日数を表示するため。

3. 結果を JSON ファイル `/tmp/research-results.json` に書く（形式は下記）。`subsidyMax` は円の数字文字列でよい。発掘した新規制度は `programs` に、提案カードは `items` に。`items[].programId` は `prog:<slug>`（新規なら programs と同じ slug、既存なら existingPrograms の id）。

4. `pnpm research:import /tmp/research-results.json` を実行してDBへ反映（programs追加・proposals保存・matches再構築・`ready`化）。

5. 反映件数を報告する。提案は「使える根拠・使えるか（要確認点込み）・準備物・時期/予告・出典」を items に必ず入れること。水増しせず、本当に使えるものだけ。

## /tmp/research-results.json の形式

```json
{
  "results": [
    {
      "businessId": "<pendingの id>",
      "summary": "総括（2〜3文）",
      "programs": [
        {
          "slug": "tokyo-sogyo-josei", "name": "...", "level": "prefecture|municipal|national",
          "prefecture": "東京都", "areaSearch": "東京都", "purpose": "...",
          "targetIndustries": ["全業種"], "targetSize": "中小企業者", "subsidyRate": "2/3",
          "subsidyMax": "3000000", "keyRequirements": ["..."], "applicationFrames": ["..."],
          "typicalSchedule": "...", "budgetBasis": "...", "officialUrl": "https://...",
          "scheduleKey": "...", "status": "active", "nextOpen": "2026-09", "confidence": 0.9,
          "isLargeAmount": false, "isStartup": true, "unifiedWith": "", "sources": ["https://..."], "notes": ""
        }
      ],
      "items": [
        {
          "programId": "prog:tokyo-sogyo-josei", "fitReason": "...", "eligibility": "...",
          "usability": "...", "prepare": ["..."], "scheduleNote": "...",
          "deadline": "2026-12-15", "score": 0.9,
          "confidence": 0.9, "sources": ["https://..."],
          "name": "...", "officialUrl": "https://...", "subsidyMax": 3000000, "subsidyRate": "2/3",
          "areaSearch": "東京都", "level": "prefecture", "status": "active", "nextOpen": "2026-09",
          "isLargeAmount": false, "isStartup": true
        }
      ]
    }
  ]
}
```

注意: このコマンドは**コストのかかる従量APIスクリプト（build-proposals の deep / research-catalog）を呼ばない**。調査はこのセッションの WebSearch/WebFetch で行い、結果の保存だけ `research:import` を使う。
