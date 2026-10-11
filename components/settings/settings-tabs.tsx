"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Activity, FlaskConical, HardDrive, Users, type LucideIcon } from "lucide-react";

import { AiTestPanel } from "@/components/settings/ai-test-panel";
import { PlatformStatusPanel } from "@/components/settings/platform-status-panel";
import { StoragePanel } from "@/components/settings/storage-panel";
import { TeamPanel } from "@/components/settings/team-panel";
import { cn } from "@/lib/utils";

type TabId = "team" | "system" | "storage" | "ai-test";

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: "team", label: "Команда", icon: Users },
  { id: "system", label: "Система", icon: Activity },
  { id: "storage", label: "Хранилище", icon: HardDrive },
  { id: "ai-test", label: "Тест ИИ", icon: FlaskConical },
];

const PANELS: Record<TabId, () => JSX.Element> = {
  team: () => <TeamPanel />,
  system: () => <PlatformStatusPanel />,
  storage: () => <StoragePanel />,
  "ai-test": () => <AiTestPanel />,
};

export function SettingsTabs() {
  const [active, setActive] = useState<TabId>("team");
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({
    team: null,
    system: null,
    storage: null,
    "ai-test": null,
  });

  // Вкладка хранится в адресе (#storage): обновление страницы и ссылки
  // возвращают туда же, где были.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    const found = TABS.find((t) => t.id === hash);
    if (found) setActive(found.id);
  }, []);

  function select(id: TabId, focus = false) {
    setActive(id);
    window.history.replaceState(null, "", `#${id}`);
    if (focus) tabRefs.current[id]?.focus();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const index = TABS.findIndex((t) => t.id === active);
    let next = index;
    switch (e.key) {
      case "ArrowRight":
        next = (index + 1) % TABS.length;
        break;
      case "ArrowLeft":
        next = (index - 1 + TABS.length) % TABS.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = TABS.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    select(TABS[next].id, true);
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Разделы настроек"
        onKeyDown={handleKeyDown}
        className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1"
      >
        {TABS.map(({ id, label, icon: Icon }) => {
          const selected = id === active;
          return (
            <button
              key={id}
              ref={(el) => {
                tabRefs.current[id] = el;
              }}
              type="button"
              role="tab"
              id={`settings-tab-${id}`}
              aria-selected={selected}
              aria-controls={`settings-panel-${id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(id)}
              className={cn(
                "inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`settings-panel-${active}`}
        aria-labelledby={`settings-tab-${active}`}
      >
        {PANELS[active]()}
      </div>
    </div>
  );
}
