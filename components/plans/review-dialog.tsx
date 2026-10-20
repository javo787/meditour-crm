"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PlanWarning } from "@/lib/plans/schema";
import { canReview, warningCounts } from "@/lib/plans/ui";

export type ReviewConfirmations = Record<"amounts" | "clinics" | "patient", boolean>;

// Три подтверждения из §9: суммы, врачи и клиники, имя и пол пациента. Нативные чекбоксы.
const CONFIRMATIONS: { key: keyof ReviewConfirmations; label: string }[] = [
  { key: "amounts", label: "Суммы сверены с письмом" },
  { key: "clinics", label: "Врачи и клиники сверены с письмом" },
  { key: "patient", label: "Имя и пол пациента проверены" },
];

export interface ReviewDialogProps {
  open: boolean;
  warnings: PlanWarning[];
  busy: boolean; // запрос в полёте: диалог нельзя закрыть, кнопки заблокированы
  error?: string; // текст ошибки запроса, показывается в диалоге
  onConfirm: (confirmations: ReviewConfirmations) => void;
  onClose: () => void;
}

// Диалог «Отметить проверенным». Галочки живут во внутреннем компоненте, который Radix размонтирует при закрытии,
// поэтому при каждом открытии все три сброшены.
export function ReviewDialog({ open, warnings, busy, error, onConfirm, onClose }: ReviewDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent>
        <ReviewForm warnings={warnings} busy={busy} error={error} onConfirm={onConfirm} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

type ReviewFormProps = Omit<ReviewDialogProps, "open">;

function ReviewForm({ warnings, busy, error, onConfirm, onClose }: ReviewFormProps) {
  const [confirmations, setConfirmations] = useState<ReviewConfirmations>({
    amounts: false,
    clinics: false,
    patient: false,
  });
  const errorCount = warningCounts(warnings).error;
  const allChecked = Object.values(confirmations).every(Boolean);
  const ready = canReview(warnings, confirmations);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Отметить план проверенным</DialogTitle>
        <DialogDescription>
          Подтвердите, что сверили данные с письмом. После этого PDF выходит без водяного знака «ЧЕРНОВИК».
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3 px-6 py-4">
        {CONFIRMATIONS.map(({ key, label }) => (
          <label key={key} className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              checked={confirmations[key]}
              disabled={busy}
              onChange={(e) => setConfirmations((prev) => ({ ...prev, [key]: e.target.checked }))}
            />
            <span>{label}</span>
          </label>
        ))}
        {errorCount > 0 ? (
          <p className="text-sm text-destructive">
            Сначала исправьте предупреждения уровня «ошибка»: {errorCount}
          </p>
        ) : !allChecked ? (
          <p className="text-sm text-muted-foreground">Отметьте все три пункта, чтобы продолжить.</p>
        ) : null}
        <p className="text-xs text-muted-foreground">Любая правка после отметки вернёт план в статус «Черновик».</p>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          Отмена
        </Button>
        <Button
          type="button"
          onClick={() => {
            if (ready && !busy) onConfirm(confirmations);
          }}
          disabled={!ready || busy}
        >
          {busy ? "Сохраняем…" : "Отметить проверенным"}
        </Button>
      </DialogFooter>
    </>
  );
}
