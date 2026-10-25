/** @jest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { DocumentsPanel } from "@/components/leads/patient-card/documents-panel";
import { ImageLightbox } from "@/components/leads/patient-card/image-lightbox";
import type { PatientDocument } from "@/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  document.body.style.overflow = "";
});

const click = (el: Element | null) => {
  if (!el) throw new Error("element not found");
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};
const dialog = () => document.body.querySelector('[role="dialog"]');
const image = () => dialog()?.querySelector("img") ?? null;
const byLabel = (label: string) => document.body.querySelector(`[aria-label="${label}"]`);

describe("ImageLightbox", () => {
  it("shows the image full screen and closes with the X button", () => {
    const onClose = jest.fn();
    act(() => root.render(<ImageLightbox src="/photo.jpg" alt="CT report" onClose={onClose} />));

    expect(dialog()).not.toBeNull();
    expect(image()?.getAttribute("src")).toBe("/photo.jpg");

    click(byLabel("Закрыть"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes with Escape and by tapping the dark background", () => {
    const onClose = jest.fn();
    act(() => root.render(<ImageLightbox src="/photo.jpg" alt="CT report" onClose={onClose} />));

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    click(document.body.querySelector('[data-testid="lightbox-backdrop"]'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("tapping the photo zooms it in and out instead of closing", () => {
    const onClose = jest.fn();
    act(() => root.render(<ImageLightbox src="/photo.jpg" alt="CT report" onClose={onClose} />));

    expect((image() as HTMLElement).style.width).toBe("");
    click(image());
    expect((image() as HTMLElement).style.width).toBe("250%");
    click(byLabel("Уменьшить")); // кнопка лупы работает так же, как нажатие на фото
    expect((image() as HTMLElement).style.width).toBe("");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("locks page scrolling while open and restores it afterwards", () => {
    document.body.style.overflow = "auto";
    act(() => root.render(<ImageLightbox src="/photo.jpg" alt="x" onClose={() => undefined} />));
    expect(document.body.style.overflow).toBe("hidden");
    act(() => root.render(<div />));
    expect(document.body.style.overflow).toBe("auto");
  });
});

describe("DocumentsPanel thumbnails", () => {
  const doc = (over: Partial<PatientDocument>): PatientDocument => ({
    id: "d1",
    leadId: "l1",
    filename: "scan.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 1000,
    source: "upload",
    at: "2026-10-23T10:00:00Z",
    status: "done",
    attempts: 1,
    category: "report",
    title: "MRI report",
    translationEn: "Some translated text",
    reviewed: false,
    include: true,
    ...over,
  });

  it("enlarges a photo on tap and hides it again with the X", () => {
    act(() => root.render(<DocumentsPanel leadId="l1" leadName="Test" initialDocuments={[doc({})]} initialProfile={{}} />));

    expect(dialog()).toBeNull();
    click(byLabel("Увеличить фото документа"));
    expect(dialog()).not.toBeNull();
    expect(image()?.getAttribute("src")).toBe("/api/leads/l1/documents/d1/file");

    click(byLabel("Закрыть"));
    expect(dialog()).toBeNull();
  });

  it("keeps PDFs as a link that opens in a new tab", () => {
    act(() =>
      root.render(
        <DocumentsPanel
          leadId="l1"
          leadName="Test"
          initialDocuments={[doc({ mimeType: "application/pdf", filename: "labs.pdf" })]}
          initialProfile={{}}
        />
      )
    );
    expect(byLabel("Увеличить фото документа")).toBeNull();
    const link = container.querySelector('a[href="/api/leads/l1/documents/d1/file"]');
    expect(link?.getAttribute("target")).toBe("_blank");
  });
});
