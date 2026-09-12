import type { GenerationData, GraphData, SpaceData } from '@canvas/contracts';
import type { Static } from '@sinclair/typebox';
import type { Config } from '@canvas/contracts';
import { fingerprintOf, type IdempotencyScope } from './idempotency';
import type { HttpMethod } from './transport';

export type ConfigData = Static<typeof Config>;
export type Scenario = GenerationData['scenario'];

/**
 * Описание одного запроса: чем он отличается от остальных.
 *
 * Всё общее — адрес API, заголовки, сериализация тела, проверка статуса,
 * разбор ответа и ошибок — живёт в транспорте и клиенте. Поэтому новый
 * запрос добавляется одной записью в таблице ниже.
 *
 * `Data` существует только на уровне типов: она связывает эндпоинт с типом
 * ответа, и `call` возвращает уже нужный тип без приведения на месте вызова.
 */
export type Endpoint<Args, Data> = {
  readonly method: HttpMethod;
  readonly path: (args: Args) => string;
  /** Тело запроса; отсутствие означает запрос без тела. */
  readonly body?: (args: Args) => unknown;
  /** Безопасный запрос: сетевую ошибку можно повторить автоматически. */
  readonly idempotent?: true;
  /** Условие сохранения: ETag графа, полученный предыдущим запросом. */
  readonly ifMatch?: (args: Args) => string;
  /** Область и отпечаток для заголовка `Idempotency-Key`. */
  readonly key?: (args: Args) => IdempotencyScope;
  readonly __data?: Data;
};

const define = <Args = void, Data = void>(endpoint: Endpoint<Args, Data>): Endpoint<Args, Data> =>
  endpoint;

const spacePath = (spaceId: string) => `/api/spaces/${spaceId}`;

/** Запросы, которые использует приложение. Порядок — как в сценарии работы. */
export const api = {
  getConfig: define<void, ConfigData>({
    method: 'GET',
    path: () => '/api/config',
    idempotent: true,
  }),

  listSpaces: define<void, SpaceData[]>({
    method: 'GET',
    path: () => '/api/spaces',
    idempotent: true,
  }),

  createSpace: define<{ title: string }, SpaceData>({
    method: 'POST',
    path: () => '/api/spaces',
    body: (args) => ({ title: args.title }),
  }),

  getSpace: define<{ spaceId: string }, SpaceData>({
    method: 'GET',
    path: (args) => spacePath(args.spaceId),
    idempotent: true,
  }),

  getGraph: define<{ spaceId: string }, GraphData>({
    method: 'GET',
    path: (args) => `${spacePath(args.spaceId)}/graph`,
    idempotent: true,
  }),

  saveGraph: define<{ spaceId: string; graph: GraphData; etag: string }, GraphData>({
    method: 'PUT',
    path: (args) => `${spacePath(args.spaceId)}/graph`,
    // Сервер хранит полученные байты и считает от них ETag, поэтому граф
    // уходит целиком, а не по частям.
    body: (args) => args.graph,
    // Без `If-Match` сервер отвечает `428`; несовпадение даёт `412`.
    ifMatch: (args) => args.etag,
  }),

  listGenerations: define<{ spaceId: string }, GenerationData[]>({
    method: 'GET',
    path: (args) => `${spacePath(args.spaceId)}/generations`,
    idempotent: true,
  }),

  createGeneration: define<
    { spaceId: string; nodeId: string; graphETag: string; scenario: Scenario },
    GenerationData
  >({
    method: 'POST',
    path: (args) => `${spacePath(args.spaceId)}/generations`,
    body: (args) => ({
      nodeId: args.nodeId,
      graphETag: args.graphETag,
      scenario: args.scenario,
    }),
    // Запуск определяется нодой, версией графа и сценарием: пока они те же,
    // повтор идёт с прежним ключом и второй генерации не создаёт.
    key: (args) => ({
      scope: `generation:${args.spaceId}:${args.nodeId}`,
      fingerprint: fingerprintOf([args.nodeId, args.graphETag, args.scenario]),
    }),
  }),

  getGeneration: define<{ spaceId: string; generationId: string }, GenerationData>({
    method: 'GET',
    path: (args) => `${spacePath(args.spaceId)}/generations/${args.generationId}`,
    idempotent: true,
  }),
} as const;
