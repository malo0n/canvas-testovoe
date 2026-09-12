import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { Store } from '../store/createStore';

/**
 * Чтение части внешнего состояния.
 *
 * Значение селектора кэшируется по ссылке на состояние, поэтому подписка не
 * пересчитывает его на каждый рендер и не заставляет React считать снимок
 * изменившимся без повода.
 */
export function useStoreValue<S, T>(
  store: Store<S>,
  select: (state: S) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const latest = useRef(select);
  latest.current = select;
  const equal = useRef(isEqual);
  equal.current = isEqual;
  const cache = useRef<{ state: S; value: T } | null>(null);

  const snapshot = useCallback(() => {
    const state = store.get();
    const current = cache.current;
    if (current !== null && Object.is(current.state, state)) return current.value;
    const value = latest.current(state);
    if (current !== null && equal.current(current.value, value)) {
      current.state = state;
      return current.value;
    }
    cache.current = { state, value };
    return value;
  }, [store]);

  return useSyncExternalStore(store.subscribe, snapshot, snapshot);
}
