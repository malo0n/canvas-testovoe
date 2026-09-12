import { isAppError } from './errors';
import type { Endpoint } from './endpoints';
import { idempotencyKeyFor } from './idempotency';
import { send, type Result, type Send } from './transport';
import { sleep } from '../lib/sleep';

export type CallOptions = {
  signal?: AbortSignal | undefined;
  /** Сколько раз повторить безопасный запрос при обрыве связи. */
  retries?: number;
};

const NETWORK_RETRIES = 2;
const RETRY_BASE_MS = 300;

/**
 * Единственная точка вызова API.
 *
 * Из описания эндпоинта собирается запрос, дальше по одному разу на всё
 * приложение выполняются: условие `If-Match`, заголовок идемпотентности и
 * повтор безопасного запроса при обрыве связи.
 *
 * Возвращает `Result<Data>` с разобранными данными, ETag и заголовками; любая
 * неудача — это `AppError`. Изменяющие запросы автоматически не повторяются:
 * их повтор решается на уровне сценария, где известно, безопасно ли это.
 */
export async function call<Args, Data>(
  endpoint: Endpoint<Args, Data>,
  args: Args,
  options: CallOptions = {},
): Promise<Result<Data>> {
  const request: Send = {
    method: endpoint.method,
    path: endpoint.path(args),
    body: endpoint.body?.(args),
    signal: options.signal,
  };

  const headers: Record<string, string> = {};
  const condition = endpoint.ifMatch?.(args);
  if (condition !== undefined) headers['If-Match'] = condition;
  if (endpoint.key) headers['Idempotency-Key'] = idempotencyKeyFor(endpoint.key(args));
  if (condition !== undefined || endpoint.key) request.headers = headers;

  return attempt<Data>(request, options.retries ?? (endpoint.idempotent ? NETWORK_RETRIES : 0));
}

async function attempt<Data>(request: Send, retries: number): Promise<Result<Data>> {
  try {
    return await send<Data>(request);
  } catch (error) {
    if (!isAppError(error) || error.aborted || retries <= 0 || !error.retryable) throw error;
    await sleep(RETRY_BASE_MS * (NETWORK_RETRIES - retries + 1), request.signal);
    return attempt<Data>(request, retries - 1);
  }
}
