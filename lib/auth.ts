import { createHash, timingSafeEqual } from "node:crypto";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

// Вход по общему паролю: любой, кто введёт правильный пароль, попадает в CRM.
// Пароль берётся из переменной окружения DEMO_COORDINATOR_PASSWORD
// (на Render: Environment → DEMO_COORDINATOR_PASSWORD). Имя при входе
// необязательно — оно только показывается в шапке.
//
// Если переменная не задана, вход закрыт для всех (никакого пароля «по умолчанию»).

const MAX_FAILED_ATTEMPTS = 5;
const BLOCK_WINDOW_MS = 15 * 60 * 1000;
const MAX_NAME_LENGTH = 60;

type AttemptState = { count: number; resetAt: number };
const failedAttempts = new Map<string, AttemptState>();

function clientKey(headers: Record<string, unknown> | undefined): string {
  const forwarded = headers?.["x-forwarded-for"];
  const first = typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : "";
  return first || "unknown";
}

function isBlocked(key: string, now = Date.now()): boolean {
  const state = failedAttempts.get(key);
  if (!state) return false;
  if (state.resetAt <= now) {
    failedAttempts.delete(key);
    return false;
  }
  return state.count >= MAX_FAILED_ATTEMPTS;
}

function registerFailure(key: string, now = Date.now()) {
  const state = failedAttempts.get(key);
  if (!state || state.resetAt <= now) {
    failedAttempts.set(key, { count: 1, resetAt: now + BLOCK_WINDOW_MS });
  } else {
    state.count += 1;
  }
}

/** Сравнение в постоянное время (хэшируем, чтобы длины совпадали). */
export function passwordMatches(input: string, expected: string): boolean {
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Только для тестов. */
export function __resetFailedAttempts() {
  failedAttempts.clear();
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Координатор",
      credentials: {
        name: { label: "Имя", type: "text" },
        password: { label: "Пароль", type: "password" },
      },
      async authorize(credentials, req) {
        const expected = process.env.DEMO_COORDINATOR_PASSWORD;
        if (!expected) {
          console.error(
            "DEMO_COORDINATOR_PASSWORD не задан — вход закрыт. Добавьте переменную в Environment на Render.",
          );
          return null;
        }

        const key = clientKey(req?.headers as Record<string, unknown> | undefined);
        if (isBlocked(key)) {
          throw new Error("RATE_LIMITED");
        }

        const password = credentials?.password ?? "";
        if (!password || !passwordMatches(password, expected)) {
          registerFailure(key);
          return null;
        }

        failedAttempts.delete(key);
        const name =
          (credentials?.name ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH) ||
          "Координатор Meditur";
        return { id: "coordinator", name };
      },
    }),
  ],
  callbacks: {
    async session({ session }) {
      return session;
    },
  },
};
