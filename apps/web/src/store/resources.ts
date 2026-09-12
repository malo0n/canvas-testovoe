import type { GenerationData, SpaceData } from '@canvas/contracts';
import { call } from '../api/client';
import { api, type ConfigData } from '../api/endpoints';
import { reconcileById } from '../lib/collections';
import { createResource } from './resource';

/**
 * Данные приложения. Каждый ресурс — это только описание «что загрузить» и,
 * где полезно, «как слить с прежним значением». Состояние загрузки, ошибки,
 * защита от гонок и объединение одинаковых запросов приходят из `createResource`.
 */
export const configResource = createResource<void, ConfigData>({
  load: (_args, signal) => call(api.getConfig, undefined, { signal }).then((r) => r.data),
});

export const spacesResource = createResource<void, SpaceData[]>({
  load: (_args, signal) => call(api.listSpaces, undefined, { signal }).then((r) => r.data),
  merge: (previous, next) => reconcileById(previous, next, (space) => space.id) as SpaceData[],
});

export const spaceResource = createResource<{ spaceId: string }, SpaceData>({
  load: (args, signal) => call(api.getSpace, args, { signal }).then((r) => r.data),
});

/** Список генераций пространства, от новых к старым. */
export const generationsResource = createResource<{ spaceId: string }, GenerationData[]>({
  load: (args, signal) => call(api.listGenerations, args, { signal }).then((r) => r.data),
  merge: (previous, next) =>
    reconcileById(previous, next, (generation) => generation.id) as GenerationData[],
});
