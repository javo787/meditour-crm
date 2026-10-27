const mockNotify = jest.fn(async (..._args: unknown[]) => ({ status: "sent" }));

// Обёртка вызывается позже, чем отрабатывает подъём jest.mock, поэтому mockNotify уже создан.
jest.mock("@/lib/telegram-alerts", () => ({ notifyCoordinator: (...args: unknown[]) => mockNotify(...args) }));
jest.mock("@/lib/logger", () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn().mockReturnThis() }),
  newRequestId: () => "req",
}));
jest.mock("@/lib/evolution", () => ({ sendWhatsAppText: jest.fn() }));
jest.mock("@/lib/db", () => ({
  addMessage: jest.fn(async () => undefined),
  updateLead: jest.fn(async () => undefined),
  getMessages: jest.fn(async () => [{ from: "ai", at: new Date(Date.now() - 12 * 86_400_000).toISOString() }]),
}));

import { runFollowUpCheck } from "@/lib/follow-up";
import type { Lead } from "@/lib/types";

const lead = {
  id: "lead9",
  name: "Рахимов Изатулло",
  phone: "992901234567",
  stage: "estimate_sent",
  aiPaused: false,
  estimateSentAt: new Date(Date.now() - 12 * 86_400_000).toISOString(),
  followUpStep: 3,
} as unknown as Lead;

it("tells the coordinator on Telegram when a lead is escalated by the follow-up cadence", async () => {
  expect(await runFollowUpCheck(lead)).toBe("escalated");
  expect(mockNotify).toHaveBeenCalledWith("escalation", {
    id: "lead9",
    name: "Рахимов Изатулло",
    phone: "992901234567",
  });
});
