// Пациент вернулся после паузы. Gemini видит всю историю переписки, но без
// дат: сообщение через две недели выглядит для него как следующая реплика
// в том же разговоре («жду документы» — «вчера» или «давно»?). Поэтому, если
// с последнего сообщения прошло больше суток, к новому сообщению пациента
// дописывается короткая служебная подсказка — по тому же принципу, что и
// приглашение на звонок (lib/call-window.ts): к последнему ходу, а не в
// системный промпт, чтобы не сбрасывать его explicit-кэш в Gemini.

export const RETURN_GAP_HOURS = 24;

const HOUR_MS = 3_600_000;

// «1 день», «2 дня», «5 дней», «21 день», «22 дня», «11 дней».
export function russianDays(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  const word =
    mod100 >= 11 && mod100 <= 14 ? "дней" : mod10 === 1 ? "день" : mod10 >= 2 && mod10 <= 4 ? "дня" : "дней";
  return `${n} ${word}`;
}

export function returnGapHint(lastMessageAt: string | undefined, now: Date): string | undefined {
  if (!lastMessageAt) return undefined;
  const last = Date.parse(lastMessageAt);
  if (Number.isNaN(last)) return undefined;

  const hours = (now.getTime() - last) / HOUR_MS;
  if (hours < RETURN_GAP_HOURS) return undefined;

  // Число дней называем точно («14 дней»), а не «около»: модель иначе
  // округляет в уме и пишет «пару недель назад» там, где прошло 5 дней.
  const days = Math.floor(hours / 24);
  const periodText = days >= 2 ? russianDays(days) : "больше суток";

  return (
    "(Служебная подсказка, пациент её не видит.) Пациент написал после паузы: " +
    `с последнего сообщения в диалоге прошло ${periodText}. ` +
    "Поприветствуй коротко, на языке диалога, и продолжи с того, на чём остановились " +
    "(документы, вопрос, договорённость) — не начинай знакомство и анкету заново. " +
    "Если прежнее ожидание или договорённость могли устареть, уточни это одним вопросом."
  );
}
