import { runFirstContactPass } from "@/lib/first-contact";
import { createLogger } from "@/lib/logger";

const log = createLogger("first-contact-scheduler");

export const FIRST_CONTACT_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Каденция шлёт сообщения реальным пациентам, поэтому включается только явно: FIRST_CONTACT_CADENCE=on.
 * Перед включением посмотрите пробный прогон: GET /api/cron/first-contact?secret=...&dryRun=1.
 */
export function firstContactEnabled(): boolean {
  return process.env.FIRST_CONTACT_CADENCE === "on";
}

let started = false;

/**
 * Запускает проверку каждые 30 минут внутри самого сервера (на Render он и так не засыпает), так что
 * отдельный планировщик не нужен: «3 часа» выдерживаются с точностью до получаса. Прогоны идемпотентны и не
 * пересекаются, ручной вызов /api/cron/first-contact им не мешает.
 */
export function startFirstContactScheduler(intervalMs: number = FIRST_CONTACT_INTERVAL_MS): boolean {
  if (started || !firstContactEnabled()) return false;
  started = true;
  const tick = () => {
    runFirstContactPass().catch((err) => {
      log.error("прогон каденции упал", { message: err instanceof Error ? err.message : String(err) });
    });
  };
  setTimeout(tick, 60_000).unref?.();
  setInterval(tick, intervalMs).unref?.();
  log.info("планировщик каденции первых контактов запущен", { everyMinutes: Math.round(intervalMs / 60_000) });
  return true;
}

/** Только для тестов. */
export function __resetSchedulerForTests() {
  started = false;
}
