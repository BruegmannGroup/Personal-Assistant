import { useState } from "react";
import { getStoredKey, setStoredKey } from "./api";

export function useDashboardKey(): [string | null, (k: string) => void] {
  const [key, setKey] = useState<string | null>(getStoredKey());
  const update = (k: string) => {
    setStoredKey(k);
    setKey(k);
  };
  return [key, update];
}
