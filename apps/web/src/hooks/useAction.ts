import { useCallback, useEffect, useRef, useState } from 'react';
import { toAppError, type AppError } from '../api/errors';

export type ActionState = {
  pending: boolean;
  error: AppError | null;
};

export type Action<Args extends unknown[], Result> = ActionState & {
  /** Запуск действия. Пока предыдущий запуск не завершён, новый не начинается. */
  run: (...args: Args) => Promise<Result | undefined>;
  reset: () => void;
};

/**
 * Изменяющее действие: ожидание, ошибка и защита от повторного нажатия.
 *
 * Двойной клик по «Оформить» или «Оплатить» не должен отправлять второй
 * запрос. Здесь это одно правило на все кнопки приложения: пока действие
 * выполняется, повторный вызов возвращает ту же операцию, а не начинает новую.
 * Второй барьер — ключ идемпотентности в клиенте API: он защищает и от
 * повтора после потери ответа.
 *
 * Кнопка получает `pending` и `error` и не хранит своих флагов.
 */
export function useAction<Args extends unknown[], Result>(
  perform: (...args: Args) => Promise<Result>,
  options: { onSuccess?: (result: Result) => void; onError?: (error: AppError) => void } = {},
): Action<Args, Result> {
  const [state, setState] = useState<ActionState>({ pending: false, error: null });
  const inFlight = useRef<Promise<Result | undefined> | null>(null);
  const alive = useRef(true);
  const latest = useRef({ perform, options });
  latest.current = { perform, options };

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = useCallback((...args: Args): Promise<Result | undefined> => {
    if (inFlight.current !== null) return inFlight.current;
    setState(PENDING);
    const request = latest.current
      .perform(...args)
      .then((result) => {
        if (alive.current) setState(IDLE);
        latest.current.options.onSuccess?.(result);
        return result;
      })
      .catch((error: unknown) => {
        const failure = toAppError(error);
        // Отмена — часть сценария (уход со страницы, новый запуск), не ошибка.
        if (!failure.aborted) {
          if (alive.current) setState({ pending: false, error: failure });
          latest.current.options.onError?.(failure);
        } else if (alive.current) setState(IDLE);
        return undefined;
      })
      .finally(() => {
        inFlight.current = null;
      });
    inFlight.current = request;
    return request;
  }, []);

  const reset = useCallback(() => setState(IDLE), []);

  return { ...state, run, reset };
}

const IDLE: ActionState = { pending: false, error: null };
const PENDING: ActionState = { pending: true, error: null };
