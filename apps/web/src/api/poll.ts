import { isAppError } from './errors';
import { sleep } from '../lib/sleep';
import type { Result } from './transport';

export type PollSpec<T> = {
  /** Одно чтение состояния. Возвращает разобранный ответ клиента API. */
  load: (signal: AbortSignal) => Promise<Result<T>>;
  /** Признак завершения: после него опрос прекращается. */
  done: (value: T) => boolean;
  /** Промежуточные значения — чтобы интерфейс показывал ход обработки. */
  onValue?: (value: T) => void;
  signal: AbortSignal;
  /** Пауза, если сервер не прислал `Retry-After`. */
  intervalMs?: number;
  maxIntervalMs?: number;
  /** Ограничение на случай, если состояние так и не станет конечным. */
  timeoutMs?: number;
};

const DEFAULT_INTERVAL_MS = 500;
const DEFAULT_MAX_INTERVAL_MS = 3000;
const DEFAULT_TIMEOUT_MS = 120000;

/**
 * Последовательный опрос состояния до завершения.
 *
 * Одна реализация на все ожидания в приложении. Запросы идут строго друг за
 * другом, поэтому обогнать сам себя опрос не может, а отмена через `signal`
 * прерывает и запрос, и паузу: после закрытия пространства или размонтирования
 * страницы не останется ни лишнего обращения, ни поздней записи в состояние.
 *
 * Пауза берётся из `Retry-After` ответа, если сервер его прислал.
 */
export async function poll<T>(spec: PollSpec<T>): Promise<T> {
  const interval = spec.intervalMs ?? DEFAULT_INTERVAL_MS;
  const maxInterval = spec.maxIntervalMs ?? DEFAULT_MAX_INTERVAL_MS;
  const deadline = Date.now() + (spec.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  for (let attempt = 0; ; attempt += 1) {
    const result = await spec.load(spec.signal);
    spec.onValue?.(result.data);
    if (spec.done(result.data)) return result.data;
    if (Date.now() >= deadline) return result.data;
    const wait = Math.min(result.retryAfterMs ?? interval * Math.min(attempt + 1, 3), maxInterval);
    await sleep(wait, spec.signal);
  }
}

/** Отмена опроса — обычное завершение, а не ошибка для показа пользователю. */
export const ignoreAbort = (error: unknown): void => {
  if (!isAppError(error) || !error.aborted) throw error;
};
