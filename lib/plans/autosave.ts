// Очередь автосохранения плана. Не зависит от React: редактор создаёт её один раз и передаёт свою функцию save.
// Правила (§8–§9 спецификации):
// - одно сохранение в полёте;
// - правка, сделанная во время сохранения, не теряется: она уходит следующей, с версией из ответа на предыдущее;
// - conflict останавливает очередь до reset(version);
// - generating и network повторяются через retryMs с самой свежей правкой;
// - invalid не повторяется: сообщение показывается, следующая правка пробует снова.

export type SaveOutcome =
  | { ok: true; version: number }
  | { ok: false; reason: "conflict" | "generating" | "network" | "invalid"; message?: string };

export type AutosaveState =
  | { status: "idle" | "dirty" | "saving" | "saved" }
  | { status: "error"; message: string; retrying: boolean }
  | { status: "conflict" };

export interface AutosaveOptions<P> {
  initialVersion: number;
  delayMs?: number; // пауза после последней правки, по умолчанию 1500 мс
  retryMs?: number; // пауза перед повтором после generating и network, по умолчанию 3000 мс
  save: (payload: P, version: number) => Promise<SaveOutcome>;
  onState: (state: AutosaveState) => void;
  onSaved?: (version: number) => void; // вызывается после каждого успешного сохранения
}

const DEFAULT_DELAY_MS = 1500;
const DEFAULT_RETRY_MS = 3000;

// Текст по умолчанию, если сервер не прислал свой.
const FALLBACK_MESSAGE: Record<"network" | "generating", string> = {
  network: "Нет связи с сервером",
  generating: "План ещё формируется",
};

export class AutosaveQueue<P> {
  private currentVersion: number;
  private state: AutosaveState = { status: "idle" };
  private pending: { payload: P } | null = null;
  private inFlight = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  // Увеличивается при reset и dispose: ответ на запрос, отправленный до этого, уже не учитывается.
  private epoch = 0;
  private disposed = false;
  private idleWaiters: Array<() => void> = [];
  private readonly delayMs: number;
  private readonly retryMs: number;
  private readonly save: AutosaveOptions<P>["save"];
  private readonly onState: AutosaveOptions<P>["onState"];
  private readonly onSaved: AutosaveOptions<P>["onSaved"];

  constructor(options: AutosaveOptions<P>) {
    this.currentVersion = options.initialVersion;
    this.delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
    this.retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
    this.save = options.save;
    this.onState = options.onState;
    this.onSaved = options.onSaved;
  }

  // Версия, которую очередь считает актуальной на сервере (последний успешный ответ или reset).
  get version(): number {
    return this.currentVersion;
  }

  // Новая правка: последняя побеждает, отложенное сохранение запускается заново. В состоянии conflict игнорируется.
  schedule(payload: P): void {
    if (this.disposed || this.state.status === "conflict") return;
    this.pending = { payload };
    // Повтор уже запланирован: он заберёт самую свежую правку, поэтому таймер повтора не сбрасываем.
    if (this.retryTimer !== null) return;
    this.clearDebounce();
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.run();
    }, this.delayMs);
    if (!this.inFlight) this.emit({ status: "dirty" });
  }

  // Сохранить сейчас (без паузы) и вернуть промис, который выполнится, когда очередь перестанет двигаться.
  // Сохранение, которое уже идёт, не прерывается: промис ждёт его ответа.
  flush(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.clearDebounce();
    this.clearRetry();
    void this.run();
    return this.whenIdle();
  }

  // Сброс после «Обновить» или внешнего изменения: отбрасывает отложенную правку, таймеры и ответ на запрос в полёте.
  reset(version: number): void {
    this.epoch += 1;
    this.clearDebounce();
    this.clearRetry();
    this.pending = null;
    this.inFlight = false;
    this.currentVersion = version;
    this.emit({ status: "idle" });
    this.notifyIdle();
  }

  // Остановка при уходе со страницы: отбрасывает всё отложенное, ответы на запросы в полёте больше не учитываются.
  // Чтобы сохранить правки перед уходом, сначала вызовите flush().
  dispose(): void {
    this.disposed = true;
    this.epoch += 1;
    this.clearDebounce();
    this.clearRetry();
    this.pending = null;
    this.inFlight = false;
    this.notifyIdle();
  }

  private async run(): Promise<void> {
    if (this.inFlight || this.disposed || this.state.status === "conflict" || this.pending === null) return;
    const { payload } = this.pending;
    this.pending = null;
    this.clearDebounce();
    this.clearRetry();
    const epoch = this.epoch;
    this.inFlight = true;
    this.emit({ status: "saving" });
    let outcome: SaveOutcome;
    try {
      outcome = await this.save(payload, this.currentVersion);
    } catch {
      // Исключение означает, что запрос не дошёл или оборвался: считаем сетевой ошибкой и повторяем.
      outcome = { ok: false, reason: "network" };
    }
    if (epoch !== this.epoch) return;
    this.inFlight = false;
    this.handle(outcome, payload);
    this.notifyIdle();
  }

  private handle(outcome: SaveOutcome, payload: P): void {
    if (outcome.ok) {
      this.currentVersion = outcome.version;
      this.onSaved?.(outcome.version);
      if (this.pending === null) {
        this.emit({ status: "saved" });
      } else if (this.debounceTimer !== null) {
        // Правка ждёт своего таймера.
        this.emit({ status: "dirty" });
      } else {
        // Таймер уже прошёл, пока шёл запрос: отправляем сразу.
        void this.run();
      }
      return;
    }
    if (outcome.reason === "conflict") {
      this.clearDebounce();
      this.clearRetry();
      this.emit({ status: "conflict" });
      return;
    }
    // Неудачная правка не должна пропасть: если новых правок нет, она остаётся отложенной и уйдёт при повторе.
    if (this.pending === null) this.pending = { payload };
    if (outcome.reason === "invalid") {
      this.emit({
        status: "error",
        message: outcome.message ?? "Не удалось сохранить: проверьте поля",
        retrying: false,
      });
      return;
    }
    this.emit({
      status: "error",
      message: outcome.message ?? FALLBACK_MESSAGE[outcome.reason],
      retrying: true,
    });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.run();
    }, this.retryMs);
  }

  private emit(state: AutosaveState): void {
    if (this.disposed) return;
    this.state = state;
    this.onState(state);
  }

  private clearDebounce(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  // Очередь «тиха», когда нет запроса в полёте и нет отложенной правки, которая ждёт таймера.
  // Повтор после network или generating тоже считается тишиной: флаг retrying есть в состоянии.
  private isIdle(): boolean {
    return !this.inFlight && (this.pending === null || this.debounceTimer === null);
  }

  private whenIdle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  private notifyIdle(): void {
    if (this.idleWaiters.length === 0 || !this.isIdle()) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }
}
