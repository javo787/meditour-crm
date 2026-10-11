import { ObjectId } from "mongodb";

import { claimOutgoingEcho, hasMessageWithWaId } from "./db";
import { getDb } from "@/lib/mongodb";

jest.mock("@/lib/mongodb", () => ({
  getDb: jest.fn(),
}));

const leadId = new ObjectId().toString();
const now = Date.parse("2026-10-11T10:00:00.000Z");

describe("claimOutgoingEcho", () => {
  let toArray: jest.Mock;
  let find: jest.Mock;
  let updateOne: jest.Mock;
  let findOne: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    toArray = jest.fn();
    find = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({ toArray }) }),
    });
    updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    findOne = jest.fn();
    (getDb as jest.Mock).mockResolvedValue({
      collection: jest.fn().mockReturnValue({ find, updateOne, findOne }),
    });
  });

  it("эхо сообщения из CRM закрепляется за ним и не считается новым", async () => {
    const id = new ObjectId();
    toArray.mockResolvedValue([{ _id: id, text: "Ждём документы", from: "coordinator" }]);

    await expect(claimOutgoingEcho(leadId, "Ждём  документы", "WA1", now)).resolves.toBe(true);
    expect(updateOne).toHaveBeenCalledWith({ _id: id }, { $set: { waId: "WA1" } });
  });

  it("если подходящего нет — это сообщение с телефона", async () => {
    toArray.mockResolvedValue([{ _id: new ObjectId(), text: "Другое", from: "ai" }]);

    await expect(claimOutgoingEcho(leadId, "Привет, это Анвар", "WA2", now)).resolves.toBe(false);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("уже закреплённые за эхо сообщения повторно не берутся", async () => {
    toArray.mockResolvedValue([
      { _id: new ObjectId(), text: "Хорошо", from: "coordinator", waId: "WA-old" },
    ]);

    await expect(claimOutgoingEcho(leadId, "Хорошо", "WA3", now)).resolves.toBe(false);
  });

  it("ищет только недавние исходящие (ИИ и координатор), без недоставленных", async () => {
    toArray.mockResolvedValue([]);
    await claimOutgoingEcho(leadId, "Привет", "WA4", now);

    const filter = find.mock.calls[0][0];
    expect(filter.from).toEqual({ $in: ["ai", "coordinator"] });
    expect(filter.deliveryFailed).toEqual({ $ne: true });
    expect(filter.at).toEqual({ $gte: "2026-10-11T09:50:00.000Z" });
  });

  it("невалидный id лида — false без обращения к базе", async () => {
    await expect(claimOutgoingEcho("bad", "x", "WA5", now)).resolves.toBe(false);
    expect(getDb).not.toHaveBeenCalled();
  });
});

describe("hasMessageWithWaId", () => {
  it("true, если сообщение с таким id уже есть", async () => {
    const findOne = jest.fn().mockResolvedValue({ _id: new ObjectId() });
    (getDb as jest.Mock).mockResolvedValue({ collection: () => ({ findOne }) });
    await expect(hasMessageWithWaId(leadId, "WA1")).resolves.toBe(true);
  });

  it("false, если нет", async () => {
    const findOne = jest.fn().mockResolvedValue(null);
    (getDb as jest.Mock).mockResolvedValue({ collection: () => ({ findOne }) });
    await expect(hasMessageWithWaId(leadId, "WA2")).resolves.toBe(false);
  });
});
