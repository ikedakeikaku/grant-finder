/**
 * Discord 通知（運営=池田計画向けのオペレーション通知）。
 * Incoming Webhook への単純な HTTPS POST のみ。ボット不要・ホスティング非依存
 * （Vercel の Server Action からも GitHub Actions のスクリプトからも同じく使える）。
 * DISCORD_WEBHOOK_URL 未設定なら no-op（ログのみ）。
 */
export async function notifyDiscord(content: string): Promise<boolean> {
  const url = process.env.DISCORD_WEBHOOK_URL;
  const text = content.slice(0, 1900); // Discord の content 上限(2000)に余裕を持たせる
  if (!url) {
    console.log("[discord:dry-run]", text);
    return false;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    });
    if (!res.ok) {
      console.error(`[discord] 送信失敗 ${res.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[discord] 送信例外:", e instanceof Error ? e.message : e);
    return false;
  }
}
