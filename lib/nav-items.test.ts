import { FileText } from "lucide-react";

import { NAV_ITEMS } from "@/components/layout/nav-items";

describe("NAV_ITEMS", () => {
  it("has Планы right before Настройки", () => {
    const hrefs = NAV_ITEMS.map((i) => i.href);
    const plans = NAV_ITEMS.find((i) => i.href === "/dashboard/plans");
    expect(plans?.label).toBe("Планы");
    expect(plans?.icon).toBe(FileText);
    expect(plans?.exact).toBe(false);
    expect(hrefs.indexOf("/dashboard/plans")).toBe(hrefs.indexOf("/dashboard/settings") - 1);
    expect(hrefs.indexOf("/dashboard/plans")).toBe(hrefs.indexOf("/dashboard/leads") + 1);
  });
});
