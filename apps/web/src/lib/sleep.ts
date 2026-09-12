import { AppError } from '../api/errors';

/** Пауза, которую можно прервать: без неё отмена ждала бы конца интервала. */
export function sleep(ms: number, signal?: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) return Promise.reject(aborted());
  if (ms <= 0 && !signal) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(aborted());
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const aborted = () =>
  new AppError({ kind: 'aborted', code: 'ABORTED', message: 'Ожидание прервано.' });
