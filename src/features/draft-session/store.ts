import { createStore } from "zustand/vanilla";

import type { DraftPurchase, DraftSnapshot } from "@/domain/draft/types";

import { reconcileDraft, type DraftSessionState } from "./reconcile";

export type DraftSessionStore = DraftSessionState & {
  reconcile: (snapshot: DraftSnapshot) => void;
  addLocalCorrection: (purchase: DraftPurchase) => void;
  replaceLocalCorrections: (purchases: DraftPurchase[]) => void;
};

export function createDraftSessionStore(initial: DraftSessionState) {
  return createStore<DraftSessionStore>((set) => ({
    ...initial,
    reconcile: (snapshot) => set((current) => reconcileDraft(current, snapshot)),
    addLocalCorrection: (purchase) =>
      set((current) =>
        reconcileDraft(
          {
            snapshot: current.snapshot,
            localCorrections: [...current.localCorrections, purchase],
          },
          current.snapshot,
        ),
      ),
    replaceLocalCorrections: (purchases) =>
      set((current) =>
        reconcileDraft(
          { snapshot: current.snapshot, localCorrections: purchases },
          current.snapshot,
        ),
      ),
  }));
}
