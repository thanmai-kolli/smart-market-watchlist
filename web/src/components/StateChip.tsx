import type { DataState } from "../../../shared/types.ts";

/** Only shown when the price is not simply live — silence means "trust it". */
export function StateChip({ state }: { state: DataState }) {
  if (state === "live") return null;

  const label: Record<Exclude<DataState, "live">, string> = {
    delayed: "delayed",
    stale: "not traded recently",
    closed: "closed",
    halted: "halted",
    unknown: "no data",
  };

  return <span className={`chip ${state}`}>{label[state]}</span>;
}
