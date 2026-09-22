import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Lead } from "@/lib/types";

export function AnamnesisPanel({ lead }: { lead: Lead }) {
  const a = lead.anamnesis;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Анамнез</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {!a ? (
          <p className="text-muted-foreground">
            Ещё не собран — ИИ соберёт данные в переписке ниже
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Возраст</p>
                <p className="font-medium">{a.age ?? "—"}</p>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <p className="text-xs text-muted-foreground">Диагноз</p>
                <p className="font-medium">{lead.diagnosis}</p>
              </div>
              {lead.hospital && (
                <div>
                  <p className="text-xs text-muted-foreground">Клиника</p>
                  <p className="font-medium">{lead.hospital}</p>
                </div>
              )}
            </div>
            {a.proceduresDone && a.proceduresDone.length > 0 && (
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Проведено</p>
                <div className="flex flex-wrap gap-1.5">
                  {a.proceduresDone.map((p) => (
                    <span
                      key={p}
                      className="rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {a.summary && (
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Сводка от ИИ</p>
                <p className="leading-relaxed">{a.summary}</p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
