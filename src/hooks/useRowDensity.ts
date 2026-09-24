import { useState } from "react";
import { loadRowDensity, saveRowDensity, type RowDensity } from "../columns";

/** Compact vs comfortable table row height, persisted to localStorage the
 *  same way `useColumnVisibility` persists which columns are shown. */
export function useRowDensity() {
  const [density, setDensityState] = useState<RowDensity>(loadRowDensity);

  function setDensity(next: RowDensity) {
    setDensityState(next);
    saveRowDensity(next);
  }

  return { density, setDensity };
}
