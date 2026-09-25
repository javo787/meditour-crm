import { POST } from "./route";

describe("whatsapp-webhook route", () => {
  it("should return 400 when invalid JSON is provided", async () => {
    const request = new Request("http://localhost:3000/api/whatsapp-webhook", {
      method: "POST",
      body: "invalid-json",
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error).toBe("Некорректный JSON");
  });
});
