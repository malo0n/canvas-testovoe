import { AppError } from './errors';

export type HttpMethod = 'GET' | 'POST' | 'PUT';

/**
 * Разобранный ответ API. Компонентам достаётся `data` нужного типа; заголовки,
 * которые действительно нужны фронтенду, уже вынуты в поля.
 */
export type Result<T> = {
  readonly data: T;
  readonly status: number;
  readonly requestId: string | undefined;
  /** Сильный ETag графа; передаётся обратно в `If-Match` при сохранении. */
  readonly etag: string | undefined;
  /** `Location` созданного ресурса или адреса проверки статуса. */
  readonly location: string | undefined;
  /** `Retry-After` в миллисекундах; задаёт паузу опроса. */
  readonly retryAfterMs: number | undefined;
};

export type TransportConfig = {
  baseUrl: string;
  timeoutMs: number;
};

const config: TransportConfig = {
  baseUrl: (import.meta.env.VITE_API_URL ?? 'http://localhost:4001').replace(/\/+$/, ''),
  timeoutMs: 15000,
};

export function configureTransport(patch: Partial<TransportConfig>): void {
  Object.assign(config, patch);
}

/** Абсолютный адрес ресурса API: картинка результата приходит относительным путём. */
export const apiUrl = (path: string): string => `${config.baseUrl}${path}`;

const JSON_MEDIA_TYPE = 'application/json';
const NO_CONTENT = 204;
const NOT_MODIFIED = 304;

export type Send = {
  method: HttpMethod;
  path: string;
  /** `undefined` — запрос без тела; `GET` тела не принимает. */
  body?: unknown;
  /** Заголовки сверх общих: `If-Match`, `Idempotency-Key`. */
  headers?: Readonly<Record<string, string>>;
  signal?: AbortSignal | undefined;
};

/**
 * Единственное место в приложении, где вызывается `fetch`.
 *
 * Здесь собираются адрес, общие заголовки и тело, проверяется статус,
 * читается тело и любая неудача приводится к `AppError`. Наружу уходит либо
 * `Result<T>`, либо `AppError` — третьего варианта нет.
 */
export async function send<T>(request: Send): Promise<Result<T>> {
  const headers = new Headers({ Accept: JSON_MEDIA_TYPE });
  const hasBody = request.body !== undefined;
  if (hasBody) headers.set('Content-Type', JSON_MEDIA_TYPE);
  if (request.headers) {
    for (const name in request.headers) headers.set(name, request.headers[name]!);
  }

  const timeout = AbortSignal.timeout(config.timeoutMs);
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${request.path}`, {
      method: request.method,
      headers,
      // Тело сериализуется здесь, поэтому описание запроса работает со значениями.
      body: hasBody ? serialize(request.body) : undefined,
      signal,
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch (cause) {
    throw transportFailure(cause, request.signal, timeout);
  }

  const payload = await readJson(response, request);
  // `304` не ошибка: представление не изменилось, тела нет. `response.ok`
  // этого не различает, поэтому условие задано явно.
  if (!response.ok && response.status !== NOT_MODIFIED) throw httpFailure(response, payload);
  return toResult<T>(response, payload);
}

/**
 * Граф сервер хранит ровно теми байтами, которые получил, и от них считает
 * ETag. Поэтому сериализация одна на все запросы: разные способы записи того
 * же графа давали бы разные ETag.
 */
const serialize = (body: unknown): string => JSON.stringify(body);

/** Обрыв связи, таймаут и отмена приходят из `fetch` одним `DOMException`. */
function transportFailure(cause: unknown, caller: AbortSignal | undefined, timeout: AbortSignal) {
  if (caller?.aborted) {
    return new AppError({ kind: 'aborted', code: 'ABORTED', message: 'Запрос отменён.', cause });
  }
  if (timeout.aborted) {
    return new AppError({ kind: 'timeout', code: 'TIMEOUT', message: 'Таймаут запроса.', cause });
  }
  return new AppError({ kind: 'network', code: 'NETWORK', message: 'Нет связи.', cause });
}

/** `204` и `304` приходят без тела, поэтому `json()` для них не вызывается. */
async function readJson(response: Response, request: Send): Promise<unknown> {
  if (response.status === NO_CONTENT || response.status === NOT_MODIFIED) return undefined;
  let text: string;
  try {
    text = await response.text();
  } catch (cause) {
    throw new AppError({
      kind: 'network',
      code: 'NETWORK',
      message: 'Соединение прервано.',
      status: response.status,
      cause,
    });
  }
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new AppError({
      kind: 'malformed',
      code: 'MALFORMED_RESPONSE',
      message: `Не удалось разобрать ответ ${request.method} ${request.path}.`,
      status: response.status,
      requestId: response.headers.get('X-Request-Id') ?? undefined,
      cause,
    });
  }
}

type ErrorPayload = { error?: { code?: unknown; message?: unknown } };

function httpFailure(response: Response, payload: unknown): AppError {
  const body = (payload ?? {}) as ErrorPayload;
  return new AppError({
    kind: 'http',
    status: response.status,
    code: typeof body.error?.code === 'string' ? body.error.code : `HTTP_${response.status}`,
    message: typeof body.error?.message === 'string' ? body.error.message : response.statusText,
    requestId: response.headers.get('X-Request-Id') ?? undefined,
  });
}

function toResult<T>(response: Response, payload: unknown): Result<T> {
  const retryAfter = response.headers.get('Retry-After');
  return {
    data: payload as T,
    status: response.status,
    requestId: response.headers.get('X-Request-Id') ?? undefined,
    etag: response.headers.get('ETag') ?? undefined,
    location: response.headers.get('Location') ?? undefined,
    retryAfterMs: retryAfter === null ? undefined : toDelayMs(retryAfter),
  };
}

/** `Retry-After` приходит числом секунд; HTTP-дата тоже допустима спецификацией. */
function toDelayMs(value: string): number | undefined {
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}
