import type { PlanCodingSessionRecord, PlanId } from "@t3tools/contracts";
import { createContext, useContext, type ReactNode } from "react";

export interface CodingSessionScreenContextValue {
  readonly planId: PlanId | null;
  readonly planTitle: string;
  readonly sessionRecord: PlanCodingSessionRecord | null;
}

const SessionScreenContext = createContext<CodingSessionScreenContextValue | null>(null);

export function CodingSessionScreenProvider(props: {
  readonly value: CodingSessionScreenContextValue;
  readonly children: ReactNode;
}) {
  return (
    <SessionScreenContext.Provider value={props.value}>
      {props.children}
    </SessionScreenContext.Provider>
  );
}

export function useCodingSessionScreen(): CodingSessionScreenContextValue | null {
  return useContext(SessionScreenContext);
}
