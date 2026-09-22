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
import { STAGE_STYLES, stageLabel } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { Lead } from "@/lib/types";

const columns: ColumnDef<Lead>[] = [
  {
    accessorKey: "name",
    header: "Пациент",
    cell: ({ row }) => (
      <div>
        <p className="font-medium">{row.original.name}</p>
        <p className="text-xs text-muted-foreground">{row.original.phone}</p>
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
      <Badge className={cn("border-transparent", STAGE_STYLES[row.original.stage])}>
        {stageLabel(row.original.stage)}
      </Badge>
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

  return (
    <div className="flex-1 overflow-auto rounded-lg border border-border">
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
          {table.getRowModel().rows.map((row) => (
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
          {table.getRowModel().rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-muted-foreground">
                Ничего не найдено — измените фильтр или запрос
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
