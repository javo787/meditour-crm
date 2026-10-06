"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowUpDown } from "lucide-react";
import { format, isPast } from "date-fns";
import { ru } from "date-fns/locale";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PhoneLink } from "@/components/leads/phone-link";
import { TagChip } from "@/components/leads/tag-chip";
import { WaitingBadge } from "@/components/leads/waiting-badge";
import { getWaitingBadge, STAGE_STYLES, stageLabel } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { Lead } from "@/lib/types";

const columns: ColumnDef<Lead>[] = [
  {
    accessorKey: "name",
    header: "Пациент",
    cell: ({ row }) => (
      <div className="flex items-center gap-1.5">
        <div className="min-w-0">
          <p className="truncate font-medium">{row.original.name}</p>
          <p className="truncate text-xs text-muted-foreground">{row.original.phone}</p>
        </div>
        <PhoneLink phone={row.original.phone} />
      </div>
    ),
  },
  {
    accessorKey: "diagnosis",
    header: "Диагноз",
    cell: ({ row }) => (
      <span className="line-clamp-2 max-w-xs text-sm">{row.original.diagnosis}</span>
    ),
  },
  {
    accessorKey: "stage",
    header: "Статус",
    cell: ({ row }) => (
      <div className="flex flex-wrap items-center gap-1">
        <Badge className={cn("border-transparent", STAGE_STYLES[row.original.stage])}>
          {stageLabel(row.original.stage)}
        </Badge>
        <WaitingBadge lead={row.original} />
        {row.original.tags?.map((tag) => (
          <TagChip key={tag} tag={tag} />
        ))}
      </div>
    ),
  },
  {
    accessorKey: "nextTouch",
    header: "Дата касания",
    cell: ({ row }) => {
      const date = new Date(row.original.nextTouch);
      const overdue = isPast(date);
      return (
        <span className={cn("text-sm", overdue && "font-medium text-destructive")}>
          {format(date, "d MMMM", { locale: ru })}
          {overdue && " · просрочено"}
        </span>
      );
    },
  },
  {
    accessorKey: "assignee",
    header: "Ответственный",
    cell: ({ row }) => <span className="text-sm">{row.original.assignee}</span>,
  },
];

export function LeadsTable({ data }: { data: Lead[] }) {
  const router = useRouter();
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rows = table.getRowModel().rows;

  return (
    <>
      {/* 5 колонок с горизонтальным скроллом на телефоне — не профессиональный
          UX; ниже md показываем те же данные карточками, список один и тот же
          getRowModel(), просто два разных способа его отрисовать. */}
      <div className="hidden flex-1 overflow-auto rounded-lg border border-border md:block">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-card">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-border">
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className="px-4 py-2.5">
                    {header.isPlaceholder ? null : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="-ml-3 h-7 gap-1 px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() && <ArrowUpDown className="h-3 w-3" />}
                      </Button>
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => router.push(`/dashboard/leads/${row.original.id}`)}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-secondary/50"
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Ничего не найдено — измените фильтр или запрос
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto md:hidden">
        {rows.map((row) => {
          const lead = row.original;
          const overdue =
            lead.stage !== "won" && lead.stage !== "declined" && isPast(new Date(lead.nextTouch));
          return (
            <Card
              key={row.id}
              onClick={() => router.push(`/dashboard/leads/${lead.id}`)}
              className="cursor-pointer p-3 active:bg-secondary/50"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{lead.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{lead.phone}</p>
                  </div>
                  <PhoneLink phone={lead.phone} />
                </div>
                <Badge className={cn("shrink-0 border-transparent", STAGE_STYLES[lead.stage])}>
                  {stageLabel(lead.stage)}
                </Badge>
              </div>
              {(getWaitingBadge(lead) || lead.tags?.length) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  <WaitingBadge lead={lead} />
                  {lead.tags?.map((tag) => (
                    <TagChip key={tag} tag={tag} />
                  ))}
                </div>
              )}
              <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{lead.diagnosis}</p>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="truncate">{lead.assignee}</span>
                <span className={cn("shrink-0", overdue && "font-medium text-destructive")}>
                  {format(new Date(lead.nextTouch), "d MMMM", { locale: ru })}
                  {overdue && " · просрочено"}
                </span>
              </div>
            </Card>
          );
        })}
        {rows.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Ничего не найдено — измените фильтр или запрос
          </p>
        )}
      </div>
    </>
  );
}
