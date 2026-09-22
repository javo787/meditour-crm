import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

// Демо-авторизация одним координаторским аккаунтом (см. .env.example).
// На Этапе 1 план явно требует "оставить систему авторизации (NextAuth)" —
// здесь она рабочая, но провайдер учётных записей нужно будет заменить на
// реальную таблицу пользователей/ролей.
export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Координатор",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Пароль", type: "password" },
      },
      async authorize(credentials) {
        const demoEmail =
          process.env.DEMO_COORDINATOR_EMAIL ?? "coordinator@meditour.local";
        const demoPassword =
          process.env.DEMO_COORDINATOR_PASSWORD ?? "meditour2026";

        if (
          credentials?.email === demoEmail &&
          credentials?.password === demoPassword
        ) {
          return { id: "1", name: "Координатор Meditour", email: demoEmail };
        }
        return null;
      },
    }),
  ],
  callbacks: {
    async session({ session }) {
      return session;
    },
  },
};
