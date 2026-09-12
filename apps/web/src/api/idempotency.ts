import { canonical } from '../lib/canonical';
import { persisted } from '../lib/storage';

/**
 * Ключи идемпотентности для запуска генерации.
 *
 * Правило из задания: «повтор сохраняет тело и ключ, новый запуск получает
 * новый ключ». Здесь оно выражено одним сравнением отпечатка запроса. Пока
 * тело не менялось, возвращается прежний ключ — повтор после потери ответа не
 * создаёт вторую генерацию. Как только тело изменилось (другой текст, другая
 * версия графа, другой сценарий), это уже другой запуск, и ключ новый.
 *
 * Ключи переживают перезагрузку страницы, иначе повтор после неё создал бы дубль.
 */
export type IdempotencyScope = { scope: string; fingerprint: string };

type Entry = { fingerprint: string; key: string };

const isRecord = (raw: unknown): raw is Record<string, Entry> =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw);

const table = persisted<Record<string, Entry>>(
  'canvas.idempotency',
  (raw) => (isRecord(raw) ? raw : undefined),
  {},
);

export function idempotencyKeyFor({ scope, fingerprint }: IdempotencyScope): string {
  const entries = table.read();
  const current = entries[scope];
  if (current !== undefined && current.fingerprint === fingerprint) return current.key;
  const key = crypto.randomUUID();
  // Запись идёт в тот же объект: карта ключей не участвует в отрисовке,
  // поэтому копия ради новой ссылки была бы лишней.
  entries[scope] = { fingerprint, key };
  table.write(entries);
  return key;
}

/** Отпечаток по телу запроса: любое изменение данных даёт новый ключ. */
export const fingerprintOf = (body: unknown): string => canonical(body);

export const resetIdempotency = (): void => table.clear();
