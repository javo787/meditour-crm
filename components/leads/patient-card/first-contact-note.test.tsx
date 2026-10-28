/** @jest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { FirstContactNote } from "@/components/leads/patient-card/first-contact-note";
import { describeFirstContact } from "@/lib/first-contact-view";
import type { FirstContactState } from "@/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const scheduled: FirstContactState = {
  phase: "scheduled",
  cycleKey: "none",
  anchorAt: "2026-10-28T04:00:00.000Z",
  touch1DueAt: "2026-10-30T04:00:00.000Z",
};
const sent: FirstContactState = { ...scheduled, phase: "touch1_sent", touch1At: "2026-10-30T07:00:00.000Z" };

describe("describeFirstContact", () => {
  it("tells when the AI will write", () => {
    expect(describeFirstContact(scheduled)).toContain("30 октября");
    expect(describeFirstContact(scheduled)).toContain("с 10:00 до 19:00");
  });

  it("tells when the lead will become 'Без ответа' after the touch (a week later)", () => {
    const text = describeFirstContact(sent);
    expect(text).toContain("ИИ написал 30 октября");
    expect(text).toContain("6 ноября");
    expect(text).toContain("«Без ответа»");
  });

  it("says nothing without a cycle", () => {
    expect(describeFirstContact(undefined)).toBeUndefined();
  });
});

describe("FirstContactNote", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders nothing for a lead without a brief or a cycle", () => {
    act(() => root.render(<FirstContactNote lead={{}} />));
    expect(container.textContent).toBe("");
  });

  it("shows the AI brief and the cadence status", () => {
    act(() =>
      root.render(
        <FirstContactNote lead={{ aiBrief: { text: "Родственник, интересуется лечением суставов.", at: "2026-10-28T08:00:00.000Z" }, firstContact: scheduled }} />
      )
    );
    expect(container.textContent).toContain("Сводка ИИ");
    expect(container.textContent).toContain("Родственник, интересуется лечением суставов.");
    expect(container.textContent).toContain("30 октября");
  });

  it("keeps showing the brief after the cycle is closed (no cycle state left)", () => {
    act(() => root.render(<FirstContactNote lead={{ aiBrief: { text: "Только приветствие.", at: "2026-10-28T08:00:00.000Z" } }} />));
    expect(container.textContent).toContain("Только приветствие.");
  });
});
