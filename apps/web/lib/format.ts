import { formatRlo } from "@/lib/merit/constants";

/** "2026-10-26 12:30 UTC" */
export const utc = (iso: string | number | null | undefined) => (iso === null || iso === undefined || iso === 0 ? "—" : `${new Date(iso).toISOString().slice(0, 16).replace("T", " ")} UTC`);
export const rloText = (kelvin: string | bigint, digits = 4) => `${formatRlo(BigInt(kelvin), digits)} RLO`;
