/**
 * Минимальное внешнее хранилище под `useSyncExternalStore`.
 *
 * Состояние живёт вне React, поэтому одни и те же данные читают и канвас, и
 * панель состояния, и ноды без проброса пропсов и без повторных запросов.
 */
export type Store<S> = {
  get: () => S;
  set: (next: S | ((prev: S) => S)) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createStore<S>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      const value = typeof next === 'function' ? (next as (prev: S) => S)(state) : next;
      // Ссылка не изменилась — подписчикам нечего перерисовывать.
      if (Object.is(value, state)) return;
      state = value;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
