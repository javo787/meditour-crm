import { getLead } from "@/lib/db";
import { ObjectId } from "mongodb";

// Mock the getDb function to prevent real DB connection
jest.mock("@/lib/mongodb", () => ({
  getDb: jest.fn().mockResolvedValue({
    collection: jest.fn().mockReturnValue({
      findOne: jest.fn(),
    }),
  }),
}));

describe("lib/db", () => {
  describe("getLead", () => {
    it("should return undefined when passed an invalid ID", async () => {
      // Pass an invalid ObjectId string
      const result = await getLead("invalid-id-123");

      // Since it's invalid, it should return undefined without querying the DB
      expect(result).toBeUndefined();
    });

    it("should return undefined for a valid ID that does not exist", async () => {
       const validId = new ObjectId().toString();
       const result = await getLead(validId);
       expect(result).toBeUndefined();
    })
  });
});
