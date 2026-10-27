/** @jest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { TelegramPanel } from "@/components/settings/telegram-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<TelegramPanel />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function pressTest(response: unknown, ok = true) {
  global.fetch = jest.fn(async () => ({ ok, json: async () => response })) as unknown as typeof fetch;
  const button = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Отправить тест"));
  await act(async () => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  return container.textContent ?? "";
}

describe("TelegramPanel", () => {
  it("tells which lead's WhatsApp chat the button should open", async () => {
    const text = await pressTest({ configured: true, ok: true, sampleName: "Рахимов Изатулло" });
    expect(text).toContain("Отправлено");
    expect(text).toContain("Рахимов Изатулло");
  });

  it("explains the two Render variables when the bot is not configured", async () => {
    const text = await pressTest({ configured: false });
    expect(text).toContain("TELEGRAM_BOT_TOKEN");
    expect(text).toContain("TELEGRAM_CHAT_ID");
  });

  it("shows Telegram's error with a hint for the most common mistake", async () => {
    const text = await pressTest({ configured: true, ok: false, error: "Bad Request: chat not found" });
    expect(text).toContain("chat not found");
    expect(text).toContain("нажмите Start");
  });

  it("shows a network error when the server does not answer", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const button = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Отправить тест"));
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.textContent).toContain("Не удалось связаться с сервером");
  });
});
