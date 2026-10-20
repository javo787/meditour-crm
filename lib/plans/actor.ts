// Кто сохраняет план. Вход в CRM общий (одна пара имя + пароль, учётных записей нет),
// поэтому «кто» — это имя, введённое при входе, а не строгий аудит.
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";

export async function getActorName(): Promise<string> {
  const session = await getServerSession(authOptions);
  return session?.user?.name || "Координатор";
}
