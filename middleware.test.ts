import { config } from "./middleware";

// Тот же шаблон, по которому Next.js решает, какие пути проходят через middleware (проверка входа).
const apiMatcher = new RegExp("^" + config.matcher[1] + "$");

describe("middleware matcher", () => {
  it("leaves the public webhooks out of the sign-in check", () => {
    expect(apiMatcher.test("/api/instagram-webhook")).toBe(false);
    expect(apiMatcher.test("/api/whatsapp-webhook")).toBe(false);
  });

  it("keeps the other API routes, including the Instagram settings, under the sign-in check", () => {
    expect(apiMatcher.test("/api/leads")).toBe(true);
    expect(apiMatcher.test("/api/settings/instagram")).toBe(true);
  });
});
