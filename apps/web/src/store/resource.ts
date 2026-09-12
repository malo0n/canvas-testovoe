import { isAppError, toAppError, type AppError } from '../api/errors';
import { canonical } from '../lib/canonical';

/**
 * Асинхронные данные с одинаковым жизненным циклом: загрузка, готово, ошибка.
 *
 * Одна реализация закрывает список пространств, параметры тестового и список
 * генераций. Здесь же живут три правила, которые иначе пришлось бы повторять
 * в каждом месте загрузки:
 *
 * 1. Запоздавший ответ не подменяет более свежие данные — результат
 *    засчитывается только владельцу последнего билета.
 * 2. Параллельные обращения за одними данными дают один запрос.
 * 3. При повторной загрузке прежние данные остаются на экране, чтобы интерфейс
 *    не мигал пустым состоянием.
 */
export type Status = 'idle' | 'loading' | 'ready' | 'error';

export type ResourceState<T> = {
  readonly status: Status;
  readonly data: T | undefined;
  readonly error: AppError | undefined;
  /** Момент последнего успешного обновления; 0 — данных ещё не было. */
  readonly updatedAt: number;
};

type Entry<T> = {
  state: ResourceState<T>;
  ticket: number;
  controller: AbortController | null;
  inFlight: Promise<T> | null;
};

export type ResourceOptions<Args, T> = {
  load: (args: Args, signal: AbortSignal) => Promise<T>;
  /**
   * Слияние нового значения с прежним. Нужно, чтобы не менялись ссылки на
   * части данных, которые на самом деле не изменились.
   */
  merge?: (previous: T | undefined, next: T) => T;
};

export type Resource<Args, T> = {
  keyOf: (args: Args) => string;
  peek: (key: string) => ResourceState<T>;
  read: (args: Args) => ResourceState<T>;
  load: (args: Args, options?: { force?: boolean }) => Promise<T>;
  /** Прямая запись значения: ответ изменяющего запроса тоже свежие данные. */
  put: (args: Args, value: T) => void;
  invalidate: (args?: Args) => void;
  subscribe: (listener: () => void) => () => void;
};

const IDLE: ResourceState<never> = Object.freeze({
  status: 'idle',
  data: undefined,
  error: undefined,
  updatedAt: 0,
});

const idleState = <T>(): ResourceState<T> => IDLE as ResourceState<T>;

export function createResource<Args, T>(options: ResourceOptions<Args, T>): Resource<Args, T> {
  const entries = new Map<string, Entry<T>>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  const keyOf = (args: Args) => (args === undefined ? '' : canonical(args));
  const entryOf = (key: string): Entry<T> => {
    let entry = entries.get(key);
    if (entry === undefined) {
      entry = { state: idleState<T>(), ticket: 0, controller: null, inFlight: null };
      entries.set(key, entry);
    }
    return entry;
  };
  const commit = (entry: Entry<T>, state: ResourceState<T>) => {
    entry.state = state;
    notify();
  };

  return {
    keyOf,
    peek: (key) => entries.get(key)?.state ?? idleState<T>(),
    read: (args) => entries.get(keyOf(args))?.state ?? idleState<T>(),

    load(args, { force = false } = {}) {
      const entry = entryOf(keyOf(args));
      if (!force) {
        if (entry.inFlight !== null) return entry.inFlight;
        if (entry.state.status === 'ready') return Promise.resolve(entry.state.data as T);
      }
      // Новая загрузка обесценивает предыдущую: билет растёт, и ответ прошлого
      // запроса уже не будет записан. Прерывать его при этом не нужно — его мог
      // ждать другой вызов, и отмена оборвала бы его посреди работы. Отмена
      // остаётся за `invalidate`, где данные действительно больше не нужны.
      const ticket = (entry.ticket += 1);
      const controller = new AbortController();
      entry.controller = controller;
      commit(entry, { ...entry.state, status: 'loading', error: undefined });

      const request = options
        .load(args, controller.signal)
        .then((value) => {
          if (entry.ticket !== ticket) return value;
          const merged = options.merge ? options.merge(entry.state.data, value) : value;
          commit(entry, {
            status: 'ready',
            data: merged,
            error: undefined,
            updatedAt: Date.now(),
          });
          return merged;
        })
        .catch((error: unknown) => {
          if (entry.ticket === ticket && !(isAppError(error) && error.aborted)) {
            commit(entry, { ...entry.state, status: 'error', error: toAppError(error) });
          }
          throw error;
        })
        .finally(() => {
          if (entry.ticket === ticket) {
            entry.inFlight = null;
            entry.controller = null;
          }
        });

      entry.inFlight = request;
      // Ошибка уже записана в состояние ресурса, и вызывающий код вправе её не
      // ждать. Пустой обработчик оставляет отказ доступным тем, кто делает
      // `await`, и не превращает его в необработанное отклонение.
      request.catch(() => undefined);
      return request;
    },

    put(args, value) {
      const entry = entryOf(keyOf(args));
      // Значение пришло извне и отменяет результат текущей загрузки.
      entry.ticket += 1;
      entry.controller?.abort();
      entry.controller = null;
      entry.inFlight = null;
      const merged = options.merge ? options.merge(entry.state.data, value) : value;
      if (Object.is(merged, entry.state.data) && entry.state.status === 'ready') return;
      commit(entry, { status: 'ready', data: merged, error: undefined, updatedAt: Date.now() });
    },

    invalidate(args) {
      if (args === undefined) {
        if (entries.size === 0) return;
        for (const entry of entries.values()) entry.controller?.abort();
        entries.clear();
      } else {
        const key = keyOf(args);
        const entry = entries.get(key);
        if (entry === undefined) return;
        entry.ticket += 1;
        entry.controller?.abort();
        entries.delete(key);
      }
      notify();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
