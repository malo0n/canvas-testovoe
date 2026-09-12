import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { Resource, ResourceState } from '../store/resource';
import { swallowAppError } from '../api/errors';

export type UseResource<T> = ResourceState<T> & {
  /** Повторить запрос: используется кнопкой «Повторить» в блоке ошибки. */
  reload: () => void;
  /** Есть данные для показа, даже если сейчас идёт обновление. */
  ready: boolean;
};

/**
 * Подписка на ресурс и загрузка при появлении или смене аргументов.
 *
 * Один хук закрывает все экраны: состояние загрузки, ошибка, повтор и защита
 * от гонок живут в ресурсе, а компонент получает готовые данные.
 */
export function useResource<Args, T>(
  resource: Resource<Args, T>,
  args: Args,
  options: { enabled?: boolean } = {},
): UseResource<T> {
  const enabled = options.enabled ?? true;
  const key = resource.keyOf(args);
  const snapshot = useCallback(() => resource.peek(key), [resource, key]);
  const state = useSyncExternalStore(resource.subscribe, snapshot, snapshot);

  // Аргументы читаются из ссылки: перезапуск задаёт ключ, а не новый литерал.
  const current = useRef(args);
  current.current = args;

  // Загрузка начинается, пока данных ещё нет. Это же условие возвращает данные
  // после сброса ресурса: состояние снова становится `idle`, и запрос
  // выполняется заново без отдельной ветки в компоненте.
  useEffect(() => {
    if (!enabled || state.status !== 'idle') return;
    void resource.load(current.current).catch(swallowAppError);
  }, [resource, key, enabled, state.status]);

  const reload = useCallback(() => {
    void resource.load(current.current, { force: true }).catch(swallowAppError);
  }, [resource]);

  return { ...state, reload, ready: state.data !== undefined };
}
