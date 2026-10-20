import { AutosaveQueue, type AutosaveState, type SaveOutcome } from "./autosave";

// Тесты очереди автосохранения: таймеры подменены, ответы сервера приходят тогда, когда их выдаёт тест.

type Reply = (outcome: SaveOutcome) => void;

// save возвращает промис, который тест завершает сам: replies[i] отвечает на i-й вызов по порядку.
function createQueue(initialVersion = 1) {
  const replies: Reply[] = [];
  const save = jest.fn<Promise<SaveOutcome>, [string, number]>(
    () =>
      new Promise<SaveOutcome>((resolve) => {
        replies.push(resolve);
      }),
  );
  const states: AutosaveState[] = [];
  const saved: number[] = [];
  const queue = new AutosaveQueue<string>({
    initialVersion,
    save,
    onState: (state) => states.push(state),
    onSaved: (version) => saved.push(version),
  });
  return { queue, save, replies, states, saved };
}

// Пропускает цепочку промисов после ответа сервера (обработка ответа, следующий шаг очереди).
function settle() {
  return jest.advanceTimersByTimeAsync(0);
}

describe("AutosaveQueue", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // Review Focus №4
  it("coalesces rapid edits into one save with the latest payload", async () => {
    const { queue, save, replies, states } = createQueue();
    queue.schedule("A");
    await jest.advanceTimersByTimeAsync(1000);
    queue.schedule("B");
    await jest.advanceTimersByTimeAsync(1500);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("B", 1);
    replies[0]({ ok: true, version: 2 });
    await settle();
    expect(states[states.length - 1]).toEqual({ status: "saved" });
  });

  it("an edit made while a save is in flight is sent next, with the version from the first response", async () => {
    const { queue, save, replies } = createQueue();
    queue.schedule("A");
    await jest.advanceTimersByTimeAsync(1500);
    expect(save).toHaveBeenCalledWith("A", 1);
    queue.schedule("B");
    await jest.advanceTimersByTimeAsync(1500);
    expect(save).toHaveBeenCalledTimes(1);
    replies[0]({ ok: true, version: 2 });
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("B", 2);
    replies[1]({ ok: true, version: 3 });
    await settle();
    expect(queue.version).toBe(3);
  });

  it("a conflict stops the queue until reset(version)", async () => {
    const { queue, save, replies, states } = createQueue();
    queue.schedule("A");
    await jest.advanceTimersByTimeAsync(1500);
    replies[0]({ ok: false, reason: "conflict" });
    await settle();
    expect(states[states.length - 1]).toEqual({ status: "conflict" });
    queue.schedule("C");
    await jest.advanceTimersByTimeAsync(10000);
    expect(save).toHaveBeenCalledTimes(1);
    queue.reset(9);
    queue.schedule("D");
    await jest.advanceTimersByTimeAsync(1500);
    expect(save).toHaveBeenLastCalledWith("D", 9);
  });

  it.each(["network", "generating"] as const)(
    "%s error retries with the freshest payload after retryMs",
    async (reason) => {
      const { queue, save, replies, states } = createQueue();
      queue.schedule("D0");
      await jest.advanceTimersByTimeAsync(1500);
      replies[0]({ ok: false, reason });
      await settle();
      expect(states[states.length - 1]).toEqual({ status: "error", message: expect.any(String), retrying: true });
      queue.schedule("E");
      await jest.advanceTimersByTimeAsync(2999);
      expect(save).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(save).toHaveBeenCalledTimes(2);
      expect(save).toHaveBeenLastCalledWith("E", 1);
    },
  );

  it("a retry without new edits resends the failed payload", async () => {
    const { queue, save, replies } = createQueue();
    queue.schedule("D0");
    await jest.advanceTimersByTimeAsync(1500);
    replies[0]({ ok: false, reason: "network" });
    await settle();
    await jest.advanceTimersByTimeAsync(3000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("D0", 1);
  });

  it("an invalid payload is not retried and the message is shown", async () => {
    const { queue, save, replies, states } = createQueue();
    queue.schedule("X");
    await jest.advanceTimersByTimeAsync(1500);
    replies[0]({ ok: false, reason: "invalid", message: "Слишком длинный текст" });
    await settle();
    expect(states[states.length - 1]).toEqual({
      status: "error",
      message: "Слишком длинный текст",
      retrying: false,
    });
    await jest.advanceTimersByTimeAsync(10000);
    expect(save).toHaveBeenCalledTimes(1);
    queue.schedule("Y");
    await jest.advanceTimersByTimeAsync(1500);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("Y", 1);
  });

  it("flush saves immediately without waiting for the delay and resolves when quiet", async () => {
    const { queue, save, replies } = createQueue();
    queue.schedule("F");
    const done = queue.flush();
    expect(save).toHaveBeenCalledWith("F", 1);
    replies[0]({ ok: true, version: 2 });
    await done;
    expect(queue.version).toBe(2);
  });

  it("flush resolves only after the save in flight is answered", async () => {
    const { queue, replies } = createQueue();
    queue.schedule("A");
    await jest.advanceTimersByTimeAsync(1500);
    let resolved = false;
    const done = queue.flush().then(() => {
      resolved = true;
    });
    await settle();
    expect(resolved).toBe(false);
    replies[0]({ ok: true, version: 2 });
    await done;
    expect(resolved).toBe(true);
  });

  it("reset(version) clears the pending debounce and the retry timer", async () => {
    const { queue, save, replies } = createQueue();
    queue.schedule("P");
    queue.reset(5);
    await jest.advanceTimersByTimeAsync(10000);
    expect(save).not.toHaveBeenCalled();

    queue.schedule("Q");
    await jest.advanceTimersByTimeAsync(1500);
    expect(save).toHaveBeenLastCalledWith("Q", 5);
    replies[0]({ ok: false, reason: "network" });
    await settle();
    queue.reset(6);
    await jest.advanceTimersByTimeAsync(10000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("an answer that arrives after reset is ignored", async () => {
    const { queue, replies, saved } = createQueue();
    queue.schedule("A");
    await jest.advanceTimersByTimeAsync(1500);
    queue.reset(7);
    replies[0]({ ok: true, version: 2 });
    await settle();
    expect(queue.version).toBe(7);
    expect(saved).toEqual([]);
  });

  it("after dispose nothing is saved", async () => {
    const { queue, save, states, saved } = createQueue();
    queue.schedule("G");
    queue.dispose();
    await jest.advanceTimersByTimeAsync(10000);
    queue.schedule("H");
    await queue.flush();
    expect(save).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
    expect(states).toEqual([{ status: "dirty" }]);
  });

  it("a save answered after dispose changes nothing", async () => {
    const { queue, replies, states, saved } = createQueue();
    queue.schedule("A");
    await jest.advanceTimersByTimeAsync(1500);
    const before = states.length;
    queue.dispose();
    replies[0]({ ok: true, version: 2 });
    await settle();
    expect(saved).toEqual([]);
    expect(states.length).toBe(before);
  });
});
