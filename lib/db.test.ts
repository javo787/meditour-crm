import { getLeads } from "./db";
import { getDb } from "@/lib/mongodb";

// Mock the mongodb module
jest.mock("@/lib/mongodb", () => ({
  getDb: jest.fn(),
}));

describe("getLeads", () => {
  let mockToArray: jest.Mock;
  let mockSort: jest.Mock;
  let mockFind: jest.Mock;
  let mockCollection: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockToArray = jest.fn();
    mockSort = jest.fn().mockReturnValue({ toArray: mockToArray });
    mockFind = jest.fn().mockReturnValue({ sort: mockSort });
    mockCollection = jest.fn().mockReturnValue({ find: mockFind });

    (getDb as jest.Mock).mockResolvedValue({
      collection: mockCollection,
    });
  });

  it("should call find with an empty filter when no arguments are provided", async () => {
    mockToArray.mockResolvedValue([]);
    await getLeads();

    expect(mockCollection).toHaveBeenCalledWith("Leads");
    expect(mockFind).toHaveBeenCalledWith({});
    expect(mockSort).toHaveBeenCalledWith({ createdAt: -1 });
  });

  it("should call find with stage filter when stage is provided", async () => {
    mockToArray.mockResolvedValue([]);
    await getLeads({ stage: "new" });

    expect(mockFind).toHaveBeenCalledWith({ stage: "new" });
  });

  it("should not add stage filter when stage is 'all'", async () => {
    mockToArray.mockResolvedValue([]);
    await getLeads({ stage: "all" });

    expect(mockFind).toHaveBeenCalledWith({});
  });

  it("should call find with search query filter", async () => {
    mockToArray.mockResolvedValue([]);
    await getLeads({ q: "test" });

    const expectedRe = new RegExp("test", "i");
    expect(mockFind).toHaveBeenCalledWith({
      $or: [
        { name: expectedRe },
        { phone: expectedRe },
        { diagnosis: expectedRe },
        { homeLocation: expectedRe },
      ],
    });
  });

  it("should escape special characters in search query filter", async () => {
    mockToArray.mockResolvedValue([]);
    await getLeads({ q: "test.+" });

    const expectedRe = new RegExp("test\\.\\+", "i");
    expect(mockFind).toHaveBeenCalledWith({
      $or: [
        { name: expectedRe },
        { phone: expectedRe },
        { diagnosis: expectedRe },
        { homeLocation: expectedRe },
      ],
    });
  });

  it("should combine stage and search query filters", async () => {
    mockToArray.mockResolvedValue([]);
    await getLeads({ stage: "new", q: "test" });

    const expectedRe = new RegExp("test", "i");
    expect(mockFind).toHaveBeenCalledWith({
      stage: "new",
      $or: [
        { name: expectedRe },
        { phone: expectedRe },
        { diagnosis: expectedRe },
        { homeLocation: expectedRe },
      ],
    });
  });

});
