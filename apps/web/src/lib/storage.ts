/**
 * Типизированный доступ к `localStorage` с одной проверкой на всё приложение.
 *
 * Хранилище бывает недоступно (приватный режим, отключённые данные сайта) и
 * может содержать мусор от прошлой версии, поэтому чтение и запись всегда
 * защищены, а разбор значения проходит через `parse` владельца ключа.
 */
export type Persisted<T> = {
  read: () => T;
  write: (value: T) => void;
  clear: () => void;
};

const memory = new Map<string, string>();

function backend(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  try {
    const probe = '__canvas_probe__';
    window.localStorage.setItem(probe, probe);
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    // Резерв на время сессии: приложение продолжает работать без сохранения.
    return {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => void memory.set(key, value),
      removeItem: (key) => void memory.delete(key),
    };
  }
}

let store: ReturnType<typeof backend> | null = null;
const storage = () => (store ??= backend());

export function persisted<T>(
  key: string,
  parse: (raw: unknown) => T | undefined,
  fallback: T,
): Persisted<T> {
  let cache: { value: T } | null = null;
  return {
    read() {
      if (cache) return cache.value;
      let value: T | undefined;
      const raw = storage().getItem(key);
      if (raw !== null) {
        try {
          value = parse(JSON.parse(raw) as unknown);
        } catch {
          value = undefined;
        }
      }
      cache = { value: value ?? fallback };
      return cache.value;
    },
    write(value: T) {
      cache = { value };
      try {
        storage().setItem(key, JSON.stringify(value));
      } catch {
        // Переполнение или запрет записи не должны ломать сценарий.
      }
    },
    clear() {
      cache = null;
      try {
        storage().removeItem(key);
      } catch {
        // см. выше
      }
    },
  };
}

export const asString = (raw: unknown): string | undefined =>
  typeof raw === 'string' && raw.length > 0 ? raw : undefined;
