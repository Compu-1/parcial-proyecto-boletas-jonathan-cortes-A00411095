import type { AppState } from './types.ts';

type Listener = (state: AppState) => void;

export interface Store {
  getState(): AppState;
  /** Shallow-merges `patch` into the state and notifies every listener. */
  setState(patch: Partial<AppState>): void;
  /** Returns a function that removes the listener. */
  subscribe(listener: Listener): () => void;
}

export function createStore(initial: AppState): Store {
  let state = initial;
  const listeners = new Set<Listener>();

  return {
    getState: () => state,
    setState(patch) {
      // A new object each time, so components can compare references.
      state = { ...state, ...patch };
      for (const listener of listeners) {
        listener(state);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const initialState: AppState = {
  connection: 'connecting',
  event: null,
  seats: [],
  bookings: [],
  pendingSeatIds: [],
  checkout: { open: false, submitting: false, receipt: null },
  notices: [],
};
