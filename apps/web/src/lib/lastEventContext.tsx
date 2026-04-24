import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from "react";
import { clearLastEventId, getLastEventId as readStored, setLastEventId as writeStored } from "./lastEvent";

type Ctx = {
  lastEventId: string | null;
  setLastEventId: (id: string | null) => void;
};

const LastEventContext = createContext<Ctx | null>(null);

export function LastEventProvider({ children }: PropsWithChildren) {
  const [lastEventId, setState] = useState<string | null>(() => readStored());

  const setLastEventId = useCallback((id: string | null) => {
    if (id) writeStored(id);
    else clearLastEventId();
    setState(id);
  }, []);

  const value = useMemo(() => ({ lastEventId, setLastEventId }), [lastEventId, setLastEventId]);

  return <LastEventContext.Provider value={value}>{children}</LastEventContext.Provider>;
}

export function useLastEvent(): Ctx {
  const ctx = useContext(LastEventContext);
  if (!ctx) throw new Error("LastEventProvider requerido");
  return ctx;
}
