import type { GraphData } from '@canvas/contracts';
import { call } from '../api/client';
import { api } from '../api/endpoints';
import { isAppError } from '../api/errors';
import { createDocument, type CanvasDocument } from './document';

/** Пауза перед сохранением; совпадает с `debounceMs` из `GET /api/config`. */
const SAVE_DEBOUNCE_MS = 500;

/**
 * Граф пространства как документ с отложенным сохранением.
 *
 * Документ на пространство создаётся один раз и переиспользуется: возврат на
 * ту же страницу не теряет несохранённые правки и не заводит вторую очередь
 * сохранений.
 */
const documents = new Map<string, CanvasDocument<GraphData>>();

export function graphDocument(spaceId: string): CanvasDocument<GraphData> {
  let document = documents.get(spaceId);
  if (document === undefined) {
    document = createDocument<GraphData>({
      debounceMs: SAVE_DEBOUNCE_MS,
      load: async (signal) => {
        const result = await call(api.getGraph, { spaceId }, { signal });
        return { value: result.data, version: result.etag ?? '' };
      },
      save: (graph, etag, signal) => saveGraph(spaceId, graph, etag, signal),
    });
    documents.set(spaceId, document);
  }
  return document;
}

/**
 * Сохранение графа с условием `If-Match`.
 *
 * Отдельно разобран потерянный ответ: при обрыве связи запрос мог успеть
 * записаться. Повтор с прежним ETag тогда дал бы `412`, поэтому версия
 * перечитывается. Если она изменилась — запись прошла, и локальное состояние
 * (оно новее) отправляется поверх с актуальной версией. Если не изменилась —
 * записи не было, и ошибка возвращается как обычная сетевая для повтора.
 */
async function saveGraph(
  spaceId: string,
  graph: GraphData,
  etag: string,
  signal: AbortSignal,
): Promise<{ value: GraphData; version: string }> {
  try {
    const result = await call(api.saveGraph, { spaceId, graph, etag }, { signal });
    return { value: result.data, version: result.etag ?? etag };
  } catch (error) {
    if (!isAppError(error) || !error.uncertain) throw error;
    const current = await call(api.getGraph, { spaceId }, { signal });
    const fresh = current.etag ?? etag;
    if (fresh === etag) throw error;
    const result = await call(api.saveGraph, { spaceId, graph, etag: fresh }, { signal });
    return { value: result.data, version: result.etag ?? fresh };
  }
}
