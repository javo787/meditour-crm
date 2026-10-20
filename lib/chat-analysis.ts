import type { MessageSender } from "@/lib/types";
import { containsArabicScript, isNearDuplicate } from "@/lib/humanize";
import { getCallWindowConfig, isInCallWindow, localHour, type CallWindowConfig } from "@/lib/call-window";

// Статистика реальных переписок для настройки бота. Принципиально отдаёт
// ТОЛЬКО числа: ни текстов сообщений, ни имён, ни номеров, ни свободных
// «топ-слов» (первое слово ответа может оказаться именем пациента). Функция
// чистая (без БД и сети) — покрыта lib/chat-analysis.test.ts.

export interface AnalyzedMessage {
  leadId: string;
  from: MessageSender;
  text: string;
  at: string; // ISO datetime
  deliveryFailed?: boolean;
}

// Пометки вида «— ИИ поставлен на паузу —» — не реплики диалога (то же
// правило, что в app/api/whatsapp-webhook/route.ts).
export function isSystemNote(text: string): boolean {
  return text.startsWith("— ") && text.endsWith(" —");
}

// Пузыри одного ответа бота идут подряд; пауза дольше этой — уже другой ход
// (follow-up по расписанию, ответ после перерыва).
const TURN_GAP_MS = 120_000;
const SIMULTANEOUS_UNDER_SEC = 2;

// Признаки «воды»: ответ начинается с вводного слова. Это индикатор, а не
// приговор (например, «Хорошо, ждём» бывает и по делу) — смотреть нужно на
// динамику до/после правок промпта, а не на абсолютное значение.
const FILLER_OPENER_RE =
  /^[\s\p{Extended_Pictographic}]*(?:конечно|отлично|понимаю|разумеется|безусловно|прекрасно|замечательно|хорошо|албатта|хуб|дуруст|albatta|ajoyib|yaxshi|tushundim)(?!\p{L})/iu;

// Упоминание звонка в ответе бота (русский / таджикский / узбекский).
const CALL_MENTION_RE = /созвон|позвон|звонок|звонить|наберу|наберёт|наберет|занг|qo['’`]?ng['’`]?iroq/i;

// Порядок важен: первая подходящая категория забирает пометку.
const NOTE_CATEGORIES: Array<[string, RegExp]> = [
  ["deliveryFailed", /не доставлен/],
  ["aiFailed", /не смог ответить/],
  ["onlyRepeat", /повторить уже сказанное/],
  ["noReply", /не сформировал ответ/],
  ["arabicScript", /арабск/],
  ["autoPause", /автоматически поставлен на паузу/],
];

function round(n: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function share(part: number, total: number): number | null {
  return total === 0 ? null : round(part / total);
}

function average(values: number[]): number | null {
  return values.length === 0 ? null : round(values.reduce((a, b) => a + b, 0) / values.length, 1);
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

interface WindowCounters {
  turns: number;
  withCallMention: number;
}

export interface ChatAnalysis {
  period: { firstAt: string | null; lastAt: string | null };
  messages: {
    total: number;
    leads: number;
    patient: number;
    ai: number;
    coordinator: number;
    systemNotes: number;
    aiDeliveryFailed: number;
  };
  aiBubbles: {
    count: number;
    length: { avg: number | null; median: number | null; p90: number | null; max: number | null };
    over150Share: number | null;
    over300Share: number | null;
    fillerOpenerShare: number | null;
    exclamationShare: number | null;
    repeatedShare: number | null;
    arabicScript: number;
  };
  patientArabicScriptMessages: number;
  turns: {
    count: number;
    avgBubbles: number | null;
    bubbles: { "1": number; "2": number; "3": number; "4+": number };
    gapSeconds: {
      count: number;
      median: number | null;
      p10: number | null;
      p90: number | null;
      // Доля пауз короче 2 сек между пузырями одного ответа — «всё пришло разом».
      under2sShare: number | null;
    };
  };
  patientActivity: {
    timeZone: string;
    window: string;
    byHour: number[];
    // Сколько РАЗНЫХ пациентов писало в этот час: серия из 30 фото от одного
    // человека поднимает byHour, но не leadsByHour — по нему видно настоящий пик.
    leadsByHour: number[];
    inWindowShare: number | null;
  };
  callInvites: {
    inWindow: { turns: number; withCallMentionShare: number | null };
    outOfWindow: { turns: number; withCallMentionShare: number | null };
  };
  notes: Record<string, number>;
}

export function analyzeMessages(
  messages: AnalyzedMessage[],
  window: CallWindowConfig = getCallWindowConfig()
): ChatAnalysis {
  const sorted = [...messages].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  const byLead = new Map<string, AnalyzedMessage[]>();
  for (const m of sorted) {
    const list = byLead.get(m.leadId);
    if (list) list.push(m);
    else byLead.set(m.leadId, [m]);
  }

  let patient = 0;
  let coordinator = 0;
  let aiReal = 0;
  let aiFailed = 0;
  let systemNotes = 0;
  const notes: Record<string, number> = {};

  const aiLengths: number[] = [];
  let over150 = 0;
  let over300 = 0;
  let fillerOpeners = 0;
  let exclamations = 0;
  let repeated = 0;
  let aiArabic = 0;
  let patientArabic = 0;

  const hourCounts: number[] = new Array(24).fill(0);
  const leadHourCounts: number[] = new Array(24).fill(0);
  let patientInWindow = 0;

  const turnSizes: number[] = [];
  const gapsSec: number[] = [];
  const inWindow: WindowCounters = { turns: 0, withCallMention: 0 };
  const outOfWindow: WindowCounters = { turns: 0, withCallMention: 0 };

  for (const msgs of byLead.values()) {
    const aiTexts: string[] = [];
    const hoursSeen = new Set<number>();
    let run: { times: number[]; texts: string[] } | null = null;

    const flush = () => {
      if (!run) return;
      turnSizes.push(run.texts.length);
      for (let i = 1; i < run.times.length; i++) gapsSec.push((run.times[i] - run.times[i - 1]) / 1000);
      const bucket = isInCallWindow(new Date(run.times[0]), window) ? inWindow : outOfWindow;
      bucket.turns++;
      if (run.texts.some((t) => CALL_MENTION_RE.test(t))) bucket.withCallMention++;
      run = null;
    };

    for (const m of msgs) {
      const t = Date.parse(m.at);

      if (m.from === "ai") {
        if (isSystemNote(m.text)) {
          // Пометка не рвёт ход: она появляется посреди отправки пузырей.
          systemNotes++;
          const category = NOTE_CATEGORIES.find(([, re]) => re.test(m.text))?.[0] ?? "other";
          notes[category] = (notes[category] ?? 0) + 1;
          continue;
        }
        if (m.deliveryFailed) {
          aiFailed++;
          continue;
        }

        aiReal++;
        aiLengths.push(m.text.length);
        if (m.text.length > 150) over150++;
        if (m.text.length > 300) over300++;
        if (FILLER_OPENER_RE.test(m.text)) fillerOpeners++;
        if (m.text.includes("!")) exclamations++;
        if (isNearDuplicate(m.text, aiTexts)) repeated++;
        if (containsArabicScript(m.text)) aiArabic++;
        aiTexts.push(m.text);

        if (Number.isNaN(t)) continue;
        const current = run as { times: number[]; texts: string[] } | null;
        if (current && t - current.times[current.times.length - 1] <= TURN_GAP_MS) {
          current.times.push(t);
          current.texts.push(m.text);
        } else {
          flush();
          run = { times: [t], texts: [m.text] };
        }
        continue;
      }

      // Любое сообщение не от бота завершает его ход.
      flush();
      if (m.from === "patient") {
        patient++;
        if (containsArabicScript(m.text)) patientArabic++;
        if (!Number.isNaN(t)) {
          const when = new Date(t);
          const hour = localHour(when, window.timeZone);
          hourCounts[hour]++;
          if (!hoursSeen.has(hour)) {
            hoursSeen.add(hour);
            leadHourCounts[hour]++;
          }
          if (isInCallWindow(when, window)) patientInWindow++;
        }
      } else {
        coordinator++;
      }
    }
    flush();
  }

  const sortedLengths = [...aiLengths].sort((a, b) => a - b);
  const sortedGaps = [...gapsSec].sort((a, b) => a - b);
  const sizeCount = (pred: (n: number) => boolean) => turnSizes.filter(pred).length;

  return {
    period: {
      firstAt: sorted.length > 0 ? sorted[0].at : null,
      lastAt: sorted.length > 0 ? sorted[sorted.length - 1].at : null,
    },
    messages: {
      total: messages.length,
      leads: byLead.size,
      patient,
      ai: aiReal,
      coordinator,
      systemNotes,
      aiDeliveryFailed: aiFailed,
    },
    aiBubbles: {
      count: aiReal,
      length: {
        avg: average(aiLengths),
        median: percentile(sortedLengths, 0.5),
        p90: percentile(sortedLengths, 0.9),
        max: sortedLengths.length > 0 ? sortedLengths[sortedLengths.length - 1] : null,
      },
      over150Share: share(over150, aiReal),
      over300Share: share(over300, aiReal),
      fillerOpenerShare: share(fillerOpeners, aiReal),
      exclamationShare: share(exclamations, aiReal),
      repeatedShare: share(repeated, aiReal),
      arabicScript: aiArabic,
    },
    patientArabicScriptMessages: patientArabic,
    turns: {
      count: turnSizes.length,
      avgBubbles: average(turnSizes),
      bubbles: {
        "1": sizeCount((n) => n === 1),
        "2": sizeCount((n) => n === 2),
        "3": sizeCount((n) => n === 3),
        "4+": sizeCount((n) => n >= 4),
      },
      gapSeconds: {
        count: sortedGaps.length,
        median: percentile(sortedGaps, 0.5),
        p10: percentile(sortedGaps, 0.1),
        p90: percentile(sortedGaps, 0.9),
        under2sShare: share(sortedGaps.filter((g) => g < SIMULTANEOUS_UNDER_SEC).length, sortedGaps.length),
      },
    },
    patientActivity: {
      timeZone: window.timeZone,
      window: `${window.startHour}:00-${window.endHour}:00`,
      byHour: hourCounts,
      leadsByHour: leadHourCounts,
      inWindowShare: share(patientInWindow, patient),
    },
    callInvites: {
      inWindow: {
        turns: inWindow.turns,
        withCallMentionShare: share(inWindow.withCallMention, inWindow.turns),
      },
      outOfWindow: {
        turns: outOfWindow.turns,
        withCallMentionShare: share(outOfWindow.withCallMention, outOfWindow.turns),
      },
    },
    notes,
  };
}
