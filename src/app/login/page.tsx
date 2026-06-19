"use client";

import { useActionState } from "react";
import { sendMagicLink, type LoginState } from "./actions";

const initial: LoginState = {};

export default function LoginPage() {
  const [state, action, pending] = useActionState(sendMagicLink, initial);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-bold">補助金ファインダー</h1>
      <p className="mt-2 text-sm text-gray-600">
        メールアドレスを入力すると、ログイン用のリンクをお送りします。
        初めての方もそのまま登録できます。
      </p>

      {state.sent ? (
        <div className="mt-6 rounded-lg border border-green-300 bg-green-50 p-4 text-sm text-green-800">
          メールを送信しました。受信箱のリンクを開いてログインしてください。
        </div>
      ) : (
        <form action={action} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium">
              メールアドレス
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
              placeholder="you@example.com"
            />
          </div>
          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-black px-4 py-2 text-white disabled:opacity-50"
          >
            {pending ? "送信中..." : "ログインリンクを送る"}
          </button>
        </form>
      )}
    </main>
  );
}
