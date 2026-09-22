"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STAGES } from "@/lib/status";
import type { Stage } from "@/lib/types";

export function LeadsFilters({
  defaultQuery,
  defaultStage,
}: {
  defaultQuery: string;
  defaultStage: Stage | "all";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(defaultQuery);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  function pushParams(next: { q?: string; stage?: string }) {
    const params = new URLSearchParams();
    const q = next.q ?? query;
    const stage = next.stage ?? defaultStage;
    if (q) params.set("q", q);
    if (stage && stage !== "all") params.set("stage", stage);
    router.push(params.toString() ? `${pathname}?${params}` : pathname);
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => pushParams({ q: value }), 300);
  }

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="relative flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Имя, телефон или диагноз…"
          className="pl-8"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
        />
      </div>
      <Select value={defaultStage} onValueChange={(value) => pushParams({ stage: value })}>
        <SelectTrigger className="sm:w-52">
          <SelectValue placeholder="Все этапы" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Все этапы</SelectItem>
          {STAGES.map((s) => (
            <SelectItem key={s.key} value={s.key}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
