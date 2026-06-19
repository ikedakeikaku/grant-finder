import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * tsx スクリプト用の軽量 .env ローダ（依存なし）。
 * .env.local → .env の順に読み、既存の環境変数は上書きしない。
 * import するだけで副作用的に読み込まれる。
 */
function loadEnvFile(file: string): void {
  let text: string;
  try {
    text = readFileSync(resolve(process.cwd(), file), "utf8");
  } catch {
    return; // ファイルが無ければ何もしない（CIなどでは実環境変数を使う）
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2] ?? "";
    if (!key) continue;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");
