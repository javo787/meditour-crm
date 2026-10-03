import { KanbanSquare, Settings, Table2, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Воронка", icon: KanbanSquare, exact: true },
  { href: "/dashboard/leads", label: "Лиды", icon: Table2, exact: false },
  { href: "/dashboard/settings", label: "Настройки", icon: Settings, exact: false },
];
