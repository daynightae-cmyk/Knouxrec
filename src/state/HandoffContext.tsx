import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { LibraryKind, ProvenanceRecord, RouteLabel } from "./types";

/**
 * Cross-hub handoff.
 *
 * A file produced in one hub can be sent to another without writing it to disk
 * first and re-importing it. The blob travels by reference, the source item is
 * never modified, and each hop appends to a provenance chain that the receiver
 * stores with its own result.
 *
 * This is deliberately in-memory: a handoff that survives a reload would be a
 * second copy of the media, which is exactly what the library is for.
 */
export interface Handoff {
  id: string;
  kind: LibraryKind;
  name: string;
  blob: Blob;
  from: RouteLabel;
  /** The library record this came from, when there is one. */
  itemId: string | null;
  provenance: ProvenanceRecord[];
  sentAt: number;
}

interface HandoffContextValue {
  handoff: Handoff | null;
  /** Send a file to another hub; returns the hop that was recorded. */
  send: (input: {
    kind: LibraryKind;
    name: string;
    blob: Blob;
    from: RouteLabel;
    itemId?: string | null;
    provenance?: ProvenanceRecord[];
  }) => Handoff;
  /** Read the pending handoff for a hub without consuming it. */
  peek: (forHub: RouteLabel, kind: LibraryKind) => Handoff | null;
  /** Take and clear the pending handoff. */
  consume: () => void;
}

const HandoffContext = createContext<HandoffContextValue | null>(null);

let handoffCounter = 0;

export function HandoffProvider({ children }: { children: React.ReactNode }) {
  const [handoff, setHandoff] = useState<Handoff | null>(null);

  const send = useCallback<HandoffContextValue["send"]>(
    (input) => {
      const at = Date.now();
      const hop: ProvenanceRecord = {
        itemId: input.itemId ?? null,
        name: input.name,
        hub: input.from,
        at,
      };
      const created: Handoff = {
        id: `handoff-${at}-${(handoffCounter += 1)}`,
        kind: input.kind,
        name: input.name,
        blob: input.blob,
        from: input.from,
        itemId: input.itemId ?? null,
        provenance: [...(input.provenance ?? []), hop],
        sentAt: at,
      };
      setHandoff(created);
      return created;
    },
    [],
  );

  const peek = useCallback<HandoffContextValue["peek"]>(
    (forHub, kind) => {
      if (!handoff) return null;
      if (handoff.kind !== kind) return null;
      if (handoff.from === forHub) return null;
      return handoff;
    },
    [handoff],
  );

  const consume = useCallback(() => setHandoff(null), []);

  const value = useMemo(
    () => ({ handoff, send, peek, consume }),
    [handoff, send, peek, consume],
  );

  return <HandoffContext.Provider value={value}>{children}</HandoffContext.Provider>;
}

export function useHandoff(): HandoffContextValue {
  const value = useContext(HandoffContext);
  if (!value) throw new Error("useHandoff must be used inside HandoffProvider");
  return value;
}
