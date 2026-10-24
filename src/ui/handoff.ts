import { useCallback, useEffect, useMemo } from "react";
import { useHandoff } from "../state/HandoffContext";
import type { LibraryKind, ProvenanceRecord, RouteLabel } from "../state/types";
import type { RouteId } from "../app/capabilities";

/** Which hubs can actually receive a given kind of media. */
export const RECEIVERS: Record<LibraryKind, Array<{ hub: RouteLabel; route: RouteId }>> = {
  image: [
    { hub: "elysian", route: "elysian" },
    { hub: "batch", route: "batch" },
    { hub: "morphcore", route: "morphcore" },
    { hub: "toolbox", route: "toolbox" },
    { hub: "visual-patch", route: "visual-patch" },
  ],
  audio: [{ hub: "audio-studio", route: "audio-studio" }],
  video: [
    { hub: "toolbox", route: "toolbox" },
    { hub: "batch", route: "batch" },
  ],
};

export const HUB_LABEL_KEYS: Record<RouteLabel, string> = {
  library: "hub.library",
  toolbox: "hub.toolbox",
  elysian: "hub.elysian",
  "audio-studio": "hub.audioStudio",
  batch: "hub.batch",
  morphcore: "hub.morphcore",
  screenshots: "hub.screenshots",
  "visual-patch": "hub.visualPatch",
  templates: "hub.templates",
  recording: "hub.recording",
};

/**
 * Receive a pending handoff once, on mount or when one arrives.
 *
 * The callback gets the blob, the name and the provenance chain to carry
 * forward. The handoff is consumed immediately so a second mount does not
 * silently re-adopt the same file.
 *
 * `enabled` must be false while the hub cannot actually show the file — behind
 * an age gate or a loading boundary, for example. Consuming a handoff that the
 * user cannot see yet would silently discard it.
 */
export function useHandoffReceiver(
  hub: RouteLabel,
  kind: LibraryKind,
  onReceive: (handoff: { name: string; blob: Blob; itemId: string | null; provenance: ProvenanceRecord[] }) => void,
  enabled = true,
) {
  const { peek, consume } = useHandoff();
  const pending = enabled ? peek(hub, kind) : null;

  useEffect(() => {
    if (!pending) return;
    onReceive({
      name: pending.name,
      blob: pending.blob,
      itemId: pending.itemId,
      provenance: pending.provenance,
    });
    consume();
    // Deliberately keyed on the handoff id only: re-running on a new callback
    // identity would re-adopt after the user has already moved on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending?.id]);

  return pending;
}

/** The provenance line a hub shows under a handed-off file. */
export function useProvenanceLine(
  provenance: ProvenanceRecord[],
  t: (key: string) => string,
): string {
  return useMemo(() => {
    if (provenance.length === 0) return "";
    const hops = provenance.map((record) => `${t(HUB_LABEL_KEYS[record.hub])}: ${record.name}`);
    return `${t("handoff.via")} ${hops.join(" → ")}`;
  }, [provenance, t]);
}

/** Stable sender for a hub's "send to another workspace" control. */
export function useHandoffSender(from: RouteLabel) {
  const { send } = useHandoff();
  return useCallback(
    (input: {
      kind: LibraryKind;
      name: string;
      blob: Blob;
      itemId?: string | null;
      provenance?: ProvenanceRecord[];
    }) => send({ ...input, from }),
    [from, send],
  );
}
