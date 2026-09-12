import { isAppError, swallowAppError, toAppError, type AppError } from '../api/errors';
import { createStore, type Store } from './createStore';

/**
 * Документ с отложенным сохранением: локальные правки применяются сразу,
 * а на сервер уходит последнее состояние после паузы.
 *
 * Это общий механизм, а не только про граф. Здесь собраны правила, которые
 * иначе пришлось бы повторять в каждом месте сохранения:
 *
 * 1. **Одно сохранение на серию правок.** Таймер перезапускается на каждое
 *    изменение, поэтому быстрый набор текста или перетаскивание ноды дают один
 *    запрос после паузы.
 * 2. **Сохранения одного документа идут строго по очереди.** Пока запрос
 *    выполняется, новые правки только помечают документ изменённым; следующее
 *    сохранение начнётся после ответа и возьмёт из него свежую версию.
 * 3. **Ответ не затирает более новые правки.** Из ответа берётся только
 *    версия (`ETag`); значение остаётся тем, что сейчас на экране. Ответ
 *    прошлого запроса по определению старше локального состояния.
 * 4. **Конфликт версий не теряет работу.** При `412` черновик остаётся, а
 *    решение о перечитывании принимает пользователь.
 */
export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'conflict';

export type DocumentState<T> = {
  /** Текущее локальное значение: то, что видит пользователь. */
  readonly value: T | undefined;
  /** Версия, полученная от сервера; уходит обратно условием сохранения. */
  readonly version: string | undefined;
  readonly status: SaveStatus;
  /** Есть несохранённые правки: либо ждут таймера, либо ждут очереди. */
  readonly dirty: boolean;
  readonly loading: boolean;
  /** Ошибка загрузки или сохранения, уже разобранная. */
  readonly error: AppError | undefined;
};

export type Versioned<T> = { value: T; version: string };

export type DocumentOptions<T> = {
  load: (signal: AbortSignal) => Promise<Versioned<T>>;
  save: (value: T, version: string, signal: AbortSignal) => Promise<Versioned<T>>;
  debounceMs: number;
};

export type CanvasDocument<T> = {
  store: Store<DocumentState<T>>;
  /** Прочитать документ с сервера и заменить им локальное состояние. */
  open: (options?: { force?: boolean }) => Promise<void>;
  /** Изменить локальное значение и запланировать сохранение. */
  edit: (update: (current: T) => T) => void;
  /**
   * Досохранить всё немедленно: отменяет таймер и дожидается очереди.
   * Нужен перед действиями, которым важна актуальная серверная версия.
   */
  flush: () => Promise<DocumentState<T>>;
  /** Повторить сохранение после сетевой ошибки. */
  retry: () => Promise<DocumentState<T>>;
  close: () => void;
};

const INITIAL: DocumentState<never> = Object.freeze({
  value: undefined,
  version: undefined,
  status: 'idle',
  dirty: false,
  loading: false,
  error: undefined,
});

export function createDocument<T>(options: DocumentOptions<T>): CanvasDocument<T> {
  const store = createStore<DocumentState<T>>(INITIAL as DocumentState<T>);
  const patch = (part: Partial<DocumentState<T>>) =>
    store.set((current) => ({ ...current, ...part }));

  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let lifetime = new AbortController();

  const clearTimer = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  /**
   * Один шаг очереди. Берёт значение и версию на момент отправки, а после
   * ответа записывает только новую версию: значение к этому времени могло уйти
   * вперёд, и подменять его старым ответом нельзя.
   */
  async function push(): Promise<void> {
    const current = store.get();
    if (current.value === undefined || current.version === undefined) return;
    const sent = current.value;
    patch({ status: 'saving', dirty: false, error: undefined });
    try {
      const saved = await options.save(sent, current.version, lifetime.signal);
      const after = store.get();
      // Правки, сделанные во время запроса, остаются несохранёнными.
      const stillDirty = after.value !== sent;
      patch({
        version: saved.version,
        dirty: stillDirty,
        status: stillDirty ? 'pending' : 'saved',
        error: undefined,
      });
      if (stillDirty) await push();
    } catch (error) {
      if (isAppError(error) && error.aborted) return;
      const failure = toAppError(error);
      // Правки не сохранены — документ снова считается изменённым.
      patch({
        dirty: true,
        status: failure.code === 'GRAPH_VERSION_CONFLICT' ? 'conflict' : 'error',
        error: failure,
      });
      throw failure;
    }
  }

  /** Запуск очереди: пока предыдущее сохранение идёт, нового не начинаем. */
  function run(): Promise<void> {
    clearTimer();
    if (inFlight !== null) return inFlight;
    const request = push().finally(() => {
      inFlight = null;
    });
    inFlight = request;
    return request;
  }

  const schedule = () => {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void run().catch(swallowAppError);
    }, options.debounceMs);
  };

  /**
   * Дожидается, пока на сервере окажется актуальное состояние: снимает таймер
   * debounce, ждёт текущий запрос и отправляет правки, сделанные во время него.
   * Ограничение на число кругов защищает от бесконечного ожидания, если правки
   * идут непрерывно.
   */
  const settle = async (): Promise<DocumentState<T>> => {
    clearTimer();
    for (let round = 0; round < 10; round += 1) {
      const state = store.get();
      if (state.status === 'conflict' || state.status === 'error') return state;
      if (inFlight === null && !state.dirty) return state;
      await (inFlight ?? run()).catch(swallowAppError);
    }
    return store.get();
  };

  return {
    store,

    async open({ force = false } = {}) {
      const current = store.get();
      if (!force && current.value !== undefined) return;
      clearTimer();
      lifetime.abort();
      lifetime = new AbortController();
      patch({ loading: true, error: undefined });
      try {
        const loaded = await options.load(lifetime.signal);
        store.set({
          value: loaded.value,
          version: loaded.version,
          status: 'saved',
          dirty: false,
          loading: false,
          error: undefined,
        });
      } catch (error) {
        if (isAppError(error) && error.aborted) return;
        patch({ loading: false, error: toAppError(error) });
      }
    },

    edit(update) {
      const current = store.get();
      if (current.value === undefined) return;
      const next = update(current.value);
      // Обновление вернуло то же значение — планировать нечего.
      if (Object.is(next, current.value)) return;
      store.set({
        ...current,
        value: next,
        dirty: true,
        status: current.status === 'conflict' ? 'conflict' : 'pending',
      });
      if (current.status !== 'conflict') schedule();
    },

    flush: settle,

    async retry() {
      if (store.get().status === 'conflict') return store.get();
      await run().catch(swallowAppError);
      return store.get();
    },

    close() {
      clearTimer();
      lifetime.abort();
      lifetime = new AbortController();
      inFlight = null;
      store.set(INITIAL as DocumentState<T>);
    },
  };
}
