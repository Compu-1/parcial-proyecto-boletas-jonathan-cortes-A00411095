import type { AppState } from '../state/types.ts';

/** Contract every component follows (AGENTS.md section 5). */
export interface Component {
  /** Builds the DOM once and attaches it to `parent`. */
  mount(parent: HTMLElement): void;
  /** Reflects the new state. Called on every store change. */
  update(state: AppState): void;
  /** Removes the DOM, listeners and timers. */
  destroy(): void;
}

/**
 * Creates an element with an optional class and text. Text always goes
 * through textContent, never innerHTML.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}
