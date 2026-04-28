import { useCallback, useMemo } from "react";
import {
  formatSatsAs,
  type ResolvedBitcoinUnit,
  resolveBitcoinUnit,
  UNIT_LABEL,
} from "../services/format";
import { useAppStore } from "../store/useAppStore";

export type SatsFormatter = {
  format: (sats: number) => string;
  unit: ResolvedBitcoinUnit;
  label: string;
};

export function useFormatSats(): SatsFormatter {
  const unitPref = useAppStore((s) => s.preferences.bitcoinUnit);
  const referenceSats = useAppStore((s) => s.wallet?.balanceTotalSats ?? 0);
  const unit = useMemo(
    () => resolveBitcoinUnit(unitPref, referenceSats),
    [unitPref, referenceSats],
  );
  const format = useCallback(
    (sats: number) => formatSatsAs(sats, unit),
    [unit],
  );
  return { format, unit, label: UNIT_LABEL[unit] };
}
