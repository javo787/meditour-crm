import { ObjectId } from "mongodb";

import {
  addMessage,
  claimFirstContactTouch1,
  closeFirstContact,
  getFirstContactCandidates,
  revertFirstContactTouch1,
  saveFirstContactSchedule,
} from "./db";
import { getDb } from "@/lib/mongodb";

jest.mock("@/lib/mongodb", () => ({ getDb: jest.fn() }));

const LEAD_ID = new ObjectId().toHexString();

describe("first-contact DB transitions", () => {
  let leadsUpdateOne: jest.Mock;
  let leadsFind: jest.Mock;
  let messagesInsertOne: jest.Mock;
  let toArray: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    leadsUpdateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    toArray = jest.fn().mockResolvedValue([]);
    leadsFind = jest.fn().mockReturnValue({ sort: jest.fn().mockReturnValue({ toArray }) });
    messagesInsertOne = jest.fn().mockResolvedValue({ insertedId: new ObjectId() });
    const collections: Record<string, unknown> = {
      Leads: { updateOne: leadsUpdateOne, find: leadsFind },
      Messages: { insertOne: messagesInsertOne },
    };
    (getDb as jest.Mock).mockResolvedValue({ collection: (name: string) => collections[name] });
  });

  it("selects only early-stage leads that are not paused, not closed and not waiting for us", async () => {
    await getFirstContactCandidates();
    expect(leadsFind).toHaveBeenCalledWith({
      stage: { $in: ["new", "first_contact"] },
      aiPaused: { $ne: true },
      noResponse: { $ne: true },
      lastMessageFrom: { $nin: ["patient", "coordinator"] },
    });
  });

  it("saves the brief, the cycle state and the new touch date in one update", async () => {
    const state = { phase: "scheduled" as const, cycleKey: "none", anchorAt: "a", touch1DueAt: "d" };
    const brief = { text: "Сводка", at: "t" };
    await saveFirstContactSchedule(LEAD_ID, { state, brief, nextTouch: "2026-10-30T18:59:59.999Z" });
    expect(leadsUpdateOne).toHaveBeenCalledWith(
      { _id: new ObjectId(LEAD_ID) },
      { $set: { firstContact: state, aiBrief: brief, nextTouch: "2026-10-30T18:59:59.999Z" } }
    );
  });

  it("claims touch 1 only from the 'scheduled' phase of the same cycle", async () => {
    expect(await claimFirstContactTouch1(LEAD_ID, "cycle", { touch1At: "now", nextTouch: "later" })).toBe(true);
    expect(leadsUpdateOne.mock.calls[0][0]).toEqual({
      _id: new ObjectId(LEAD_ID),
      "firstContact.phase": "scheduled",
      "firstContact.cycleKey": "cycle",
    });
    leadsUpdateOne.mockResolvedValueOnce({ modifiedCount: 0 });
    expect(await claimFirstContactTouch1(LEAD_ID, "cycle", { touch1At: "now", nextTouch: "later" })).toBe(false);
  });

  it("puts a failed touch back to 'scheduled' and removes the sent time", async () => {
    await revertFirstContactTouch1(LEAD_ID, "cycle", { attempts: 2, nextTouch: "due" });
    expect(leadsUpdateOne).toHaveBeenCalledWith(
      { _id: new ObjectId(LEAD_ID), "firstContact.phase": "touch1_sent", "firstContact.cycleKey": "cycle" },
      {
        $set: { "firstContact.phase": "scheduled", "firstContact.attempts": 2, nextTouch: "due" },
        $unset: { "firstContact.touch1At": "" },
      }
    );
  });

  it("closing sets 'Без ответа' and drops the cycle state but keeps the brief", async () => {
    await closeFirstContact(LEAD_ID);
    expect(leadsUpdateOne).toHaveBeenCalledWith(
      { _id: new ObjectId(LEAD_ID) },
      { $set: { noResponse: true }, $unset: { firstContact: "" } }
    );
  });

  describe("a patient message ends the cycle", () => {
    it("moves a pushed-out touch back to now (only while a cycle is running) and clears the cycle", async () => {
      const message = await addMessage(LEAD_ID, "patient", "Здравствуйте");
      expect(leadsUpdateOne).toHaveBeenCalledTimes(2);

      const [bumpFilter, bumpUpdate] = leadsUpdateOne.mock.calls[0];
      expect(bumpFilter).toEqual({
        _id: new ObjectId(LEAD_ID),
        firstContact: { $exists: true },
        nextTouch: { $gt: message.at },
      });
      expect(bumpUpdate).toEqual({ $set: { nextTouch: message.at } });

      const [, update] = leadsUpdateOne.mock.calls[1];
      expect(update.$set).toMatchObject({ lastMessageFrom: "patient", noResponse: false });
      expect(update.$unset).toEqual({ firstContact: "" });
    });

    it("leaves the cycle and the manually set touch alone for messages from the bot or the coordinator", async () => {
      await addMessage(LEAD_ID, "ai", "Ассалому алейкум");
      expect(leadsUpdateOne).toHaveBeenCalledTimes(1);
      const [, update] = leadsUpdateOne.mock.calls[0];
      expect(update.$set).toMatchObject({ lastMessageFrom: "ai" });
      expect(update.$unset).toBeUndefined();
    });
  });
});
