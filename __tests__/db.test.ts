import { getLead, setAiTranscript, setCoordinatorTranscript, getAudioMessagesWithoutTranscript, getMessageById } from "@/lib/db";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";

const mockUpdateOne = jest.fn();
const mockFindOne = jest.fn();
const mockSort = jest.fn();
const mockLimit = jest.fn();
const mockToArray = jest.fn();
const mockFind = jest.fn().mockReturnValue({
  sort: mockSort.mockReturnValue({
    limit: mockLimit.mockReturnValue({
      toArray: mockToArray,
    })
  })
});
const mockCollection = jest.fn().mockReturnValue({
  findOne: mockFindOne,
  updateOne: mockUpdateOne,
  find: mockFind,
});

jest.mock("@/lib/mongodb", () => ({
  getDb: jest.fn(),
}));

describe("lib/db", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getDb as jest.Mock).mockResolvedValue({
      collection: mockCollection,
    });
  });

  describe("getLead", () => {
    it("should return undefined when passed an invalid ID", async () => {
      const result = await getLead("invalid-id-123");
      expect(result).toBeUndefined();
    });

    it("should return undefined for a valid ID that does not exist", async () => {
      mockFindOne.mockResolvedValueOnce(null);
      const result = await getLead(new ObjectId().toString());
      expect(result).toBeUndefined();
    });
  });

  describe("Voice transcripts", () => {
    it("setAiTranscript updates transcript conditionally", async () => {
      await setAiTranscript("000000000000000000000000", { text: "ai text", model: "model-1" });
      expect(mockUpdateOne).toHaveBeenCalledWith(
        {
          _id: new ObjectId("000000000000000000000000"),
          "transcript.source": { $ne: "coordinator" },
        },
        expect.objectContaining({
          $set: expect.objectContaining({
            transcript: expect.objectContaining({
              text: "ai text",
              source: "ai",
              model: "model-1",
            }),
          }),
        })
      );
    });

    it("setCoordinatorTranscript sets transcript unconditionally", async () => {
      await setCoordinatorTranscript("000000000000000000000000", "coord text");
      expect(mockUpdateOne).toHaveBeenCalledWith(
        { _id: new ObjectId("000000000000000000000000") },
        expect.objectContaining({
          $set: expect.objectContaining({
            transcript: expect.objectContaining({
              text: "coord text",
              source: "coordinator",
            }),
          }),
        })
      );
    });

    it("getAudioMessagesWithoutTranscript queries correctly", async () => {
      mockToArray.mockResolvedValueOnce([{
        _id: new ObjectId("000000000000000000000000"),
        leadId: new ObjectId("111111111111111111111111"),
        from: "patient",
        text: "hello",
        at: new Date().toISOString()
      }]);
      await getAudioMessagesWithoutTranscript("111111111111111111111111", 5);
      expect(mockFind).toHaveBeenCalledWith({
        leadId: new ObjectId("111111111111111111111111"),
        "media.kind": "audio",
        transcript: { $exists: false },
      });
      expect(mockSort).toHaveBeenCalledWith({ at: -1 });
      expect(mockLimit).toHaveBeenCalledWith(5);
    });

    it("getMessageById returns correctly", async () => {
      mockFindOne.mockResolvedValueOnce({
        _id: new ObjectId("000000000000000000000000"),
        leadId: new ObjectId("111111111111111111111111"),
        from: "patient",
        text: "hello",
        at: new Date().toISOString()
      });
      const m = await getMessageById("000000000000000000000000");
      expect(m?.text).toBe("hello");
      expect(mockFindOne).toHaveBeenCalledWith({ _id: new ObjectId("000000000000000000000000") });
    });
  });
});
