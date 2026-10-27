"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ConfirmRow {
  label: string;
  value: ReactNode;
  mono?: boolean;
}

/**
 * Confirmation before anything that moves money or can't be undone: the exact amounts and addresses, what happens
 * next, and one clearly labelled action.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  rows = [],
  note,
  confirmLabel,
  destructive = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  rows?: ConfirmRow[];
  note?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {rows.length ? (
          <dl className="bg-muted/50 grid gap-2.5 rounded-lg border p-4 text-sm">
            {rows.map((r) => (
              <div key={r.label} className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground shrink-0">{r.label}</dt>
                <dd
                  className={
                    r.mono
                      ? "mono-num min-w-0 truncate text-right font-mono text-[13px]"
                      : "min-w-0 text-right"
                  }
                >
                  {r.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {note ? <p className="text-muted-foreground text-xs leading-relaxed">{note}</p> : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
