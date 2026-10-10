import { BellRing, KanbanSquare, Settings, Table2, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact: boolean;
  /** Показывать счётчик «касания на сегодня и просроченные». */
  badge?: "due";
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Воронка", icon: KanbanSquare, exact: true },
  { href: "/dashboard/touches", label: "Касания", icon: BellRing, exact: false, badge: "due" },
  { href: "/dashboard/leads", label: "Лиды", icon: Table2, exact: false },
  { href: "/dashboard/settings", label: "Настройки", icon: Settings, exact: false },
];
