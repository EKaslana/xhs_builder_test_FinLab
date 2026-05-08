import { createContext, useContext, useState, ReactNode, useCallback, useEffect } from "react";
import { Dataset, RegResult } from "./api";
import * as api from "./api";

type Store = {
  datasets: Dataset[];
  setDatasets: (d: Dataset[]) => void;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  refresh: () => Promise<void>;
  removeDataset: (id: string) => Promise<void>;
  regResults: RegResult[];
  setRegResults: (cols: RegResult[]) => void;
};

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [regResults, setRegResults] = useState<RegResult[]>([]);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listDatasets();
      setDatasets(list);
      setActiveId((cur) => (cur && list.some((d) => d.id === cur) ? cur : list[0]?.id ?? null));
    } catch {
      // python may still be starting
    }
  }, []);

  const removeDataset = useCallback(async (id: string) => {
    await api.deleteDataset(id);
    await refresh();
  }, [refresh]);

  useEffect(() => {
    refresh();
    const t = setInterval(() => {
      // refresh in background occasionally to pick up server-side merges
    }, 30000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <Ctx.Provider value={{ datasets, setDatasets, activeId, setActiveId, refresh, removeDataset, regResults, setRegResults }}>
      {children}
    </Ctx.Provider>
  );
}

export function useStore() {
  const c = useContext(Ctx);
  if (!c) throw new Error("StoreProvider missing");
  return c;
}
