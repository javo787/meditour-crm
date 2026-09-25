import { GET } from "../route";
import { getLeads } from "@/lib/db";
import { testApiHandler } from "next-test-api-route-handler";

jest.mock("@/lib/db", () => ({
  getLeads: jest.fn(),
}));

describe("GET /api/leads", () => {
  const mockedGetLeads = getLeads as jest.MockedFunction<typeof getLeads>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return all leads when no query parameters are provided", async () => {
    const mockLeads = [{ id: "1", name: "John Doe", stage: "new" }];
    mockedGetLeads.mockResolvedValueOnce(mockLeads as any);

    await testApiHandler({
      appHandler: {
        GET,
      },
      url: "/api/leads",
      test: async ({ fetch }) => {
        const res = await fetch();
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data).toEqual({ leads: mockLeads });
        expect(mockedGetLeads).toHaveBeenCalledWith({ q: undefined, stage: "all" });
      },
    });
  });

  it("should pass the 'q' parameter to getLeads", async () => {
    const mockLeads = [{ id: "1", name: "John Doe", stage: "new" }];
    mockedGetLeads.mockResolvedValueOnce(mockLeads as any);

    await testApiHandler({
      appHandler: {
        GET,
      },
      url: "/api/leads?q=John",
      test: async ({ fetch }) => {
        const res = await fetch();
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data).toEqual({ leads: mockLeads });
        expect(mockedGetLeads).toHaveBeenCalledWith({ q: "John", stage: "all" });
      },
    });
  });

  it("should pass the 'stage' parameter to getLeads", async () => {
    const mockLeads = [{ id: "2", name: "Jane Smith", stage: "won" }];
    mockedGetLeads.mockResolvedValueOnce(mockLeads as any);

    await testApiHandler({
      appHandler: {
        GET,
      },
      url: "/api/leads?stage=won",
      test: async ({ fetch }) => {
        const res = await fetch();
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data).toEqual({ leads: mockLeads });
        expect(mockedGetLeads).toHaveBeenCalledWith({ q: undefined, stage: "won" });
      },
    });
  });

  it("should pass both 'q' and 'stage' parameters to getLeads", async () => {
    const mockLeads = [{ id: "2", name: "Jane Smith", stage: "won" }];
    mockedGetLeads.mockResolvedValueOnce(mockLeads as any);

    await testApiHandler({
      appHandler: {
        GET,
      },
      url: "/api/leads?q=Jane&stage=won",
      test: async ({ fetch }) => {
        const res = await fetch();
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data).toEqual({ leads: mockLeads });
        expect(mockedGetLeads).toHaveBeenCalledWith({ q: "Jane", stage: "won" });
      },
    });
  });
});
