/**
 * Единый вид ошибки для всего приложения.
 *
 * Сюда сводятся четыре разных источника: обрыв сети, таймаут, отмена запроса и
 * ответ API с телом ошибки. Дальше по коду существует только `AppError`:
 * компоненты не видят ни `Response`, ни `TypeError` из `fetch`, ни сырого тела
 * ошибки, и поэтому не повторяют разбор.
 */
export type ErrorKind = 'network' | 'timeout' | 'aborted' | 'http' | 'malformed';

type AppErrorInit = {
  kind: ErrorKind;
  code: string;
  message: string;
  status?: number;
  requestId?: string;
  cause?: unknown;
};

/**
 * Тексты, которые понятнее серверных. Сервер отвечает по-русски, поэтому
 * список короткий: здесь только то, где уместнее объяснить следующий шаг.
 */
const MESSAGES: Readonly<Record<string, string>> = {
  NETWORK: 'Нет связи с сервером. Правки сохранены локально — повторите попытку.',
  TIMEOUT: 'Сервер не ответил вовремя. Повторите действие.',
  MALFORMED_RESPONSE: 'Сервер вернул неожиданный ответ.',
  ABORTED: 'Запрос отменён.',
  GRAPH_VERSION_CONFLICT:
    'Пространство изменили в другом месте. Ваши правки сохранены здесь — перечитайте граф сервера, чтобы продолжить.',
  PRECONDITION_REQUIRED: 'Версия графа неизвестна. Перечитайте граф сервера.',
  GRAPH_CHANGED: 'Граф изменился после сохранения. Повторите запуск.',
  GENERATION_IN_PROGRESS: 'У этой ноды уже идёт генерация.',
  IDEMPOTENCY_CONFLICT: 'Данные запуска изменились. Запустите генерацию заново.',
  INCOMPLETE_CHAIN: 'Соедините текстовую ноду с генератором, а генератор — с результатом.',
  GENERATOR_REQUIRED: 'Запуск доступен только у ноды генератора.',
  INVALID_GRAPH: 'Сервер не принял граф: проверьте связи между нодами.',
  SPACE_NOT_FOUND: 'Пространство не найдено. Возможно, данные сервера сбрасывали.',
  GENERATION_NOT_FOUND: 'Генерация не найдена в этом пространстве.',
};

const FALLBACK_MESSAGE = 'Не удалось выполнить действие. Повторите попытку.';

const RETRYABLE_KINDS: ReadonlySet<ErrorKind> = new Set<ErrorKind>(['network', 'timeout']);

export class AppError extends Error {
  readonly kind: ErrorKind;
  readonly code: string;
  readonly status: number;
  readonly requestId: string | undefined;

  constructor(init: AppErrorInit) {
    super(MESSAGES[init.code] ?? init.message ?? FALLBACK_MESSAGE, { cause: init.cause });
    this.name = 'AppError';
    this.kind = init.kind;
    this.code = init.code;
    this.status = init.status ?? 0;
    this.requestId = init.requestId;
  }

  /** Повтор того же запроса может помочь: связь, таймаут, 5xx или 429. */
  get retryable(): boolean {
    return RETRYABLE_KINDS.has(this.kind) || this.status >= 500 || this.status === 429;
  }

  /** Отмена — не ошибка пользователя: такие случаи не показываются в интерфейсе. */
  get aborted(): boolean {
    return this.kind === 'aborted';
  }

  /**
   * Ответ мог дойти до сервера, но подтверждение потерялось. Прежде чем
   * повторять запись, состояние сервера нужно перечитать.
   */
  get uncertain(): boolean {
    return this.kind === 'network' || this.kind === 'timeout';
  }
}

export const isAppError = (value: unknown): value is AppError => value instanceof AppError;

/**
 * Приведение любого значения к общему виду ошибки.
 *
 * Нужно там, где в `catch` может прийти что угодно: `AppError` проходит как
 * есть, всё остальное заворачивается. Одна реализация на приложение, чтобы
 * «непредвиденная ошибка» выглядела одинаково независимо от места.
 */
export const toAppError = (error: unknown): AppError =>
  isAppError(error)
    ? error
    : new AppError({
        kind: 'malformed',
        code: 'UNEXPECTED',
        message: 'Непредвиденная ошибка.',
        cause: error,
      });

/**
 * Гашение ошибки, которая уже разобрана и записана в состояние.
 *
 * Всё, что не является `AppError`, — сбой в коде, и он пробрасывается дальше,
 * а не теряется в «висячем» промисе.
 */
export const swallowAppError = (error: unknown): void => {
  if (!isAppError(error)) throw error;
};

/** Совпадение с любым из кодов; избавляет вызовы от цепочек сравнений. */
export const hasCode = (error: unknown, ...codes: readonly string[]): boolean =>
  isAppError(error) && codes.includes(error.code);
