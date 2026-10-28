"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { passphraseStrength } from "@/lib/client/wallet";
import { cn } from "@/lib/utils";

const TONE = ["bg-danger", "bg-danger", "bg-warning", "bg-success", "bg-success"];

/**
 * A new wallet's passphrase: the field, a confirm field and a strength hint. The parent checks both with
 * `newPassphraseError` before creating the wallet.
 */
export function NewPassphraseFields({
  id,
  value,
  confirm,
  onChange,
  onConfirmChange,
  label = "Choose a passphrase",
}: {
  id: string;
  value: string;
  confirm: string;
  onChange: (v: string) => void;
  onConfirmChange: (v: string) => void;
  label?: string;
}) {
  const strength = passphraseStrength(value);
  const mismatch = confirm.length > 0 && confirm !== value;
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          type="password"
          autoComplete="new-password"
          placeholder="New passphrase (8+ characters)"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={`${id}-strength`}
          className="h-10"
        />
        <div id={`${id}-strength`} className="grid gap-1" data-testid="passphrase-strength" aria-live="polite">
          {value ? (
            <>
              <div className="flex gap-1" aria-hidden="true">
                {[1, 2, 3, 4].map((i) => (
                  <span key={i} className={cn("h-1 flex-1 rounded-full", i <= strength.score ? TONE[strength.score] : "bg-muted")} />
                ))}
              </div>
              <p className="text-muted-foreground text-xs">
                <span className="text-foreground font-medium">{strength.label}.</span> {strength.hint}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground text-xs">Merit can&apos;t reset it: the passphrase is the only way to open this wallet.</p>
          )}
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-confirm`}>Confirm passphrase</Label>
        <Input
          id={`${id}-confirm`}
          type="password"
          autoComplete="new-password"
          placeholder="Type it again"
          value={confirm}
          onChange={(e) => onConfirmChange(e.target.value)}
          aria-invalid={mismatch || undefined}
          className="h-10"
        />
        {mismatch ? <p className="text-danger text-xs">The two passphrases don&apos;t match yet.</p> : null}
      </div>
    </div>
  );
}
