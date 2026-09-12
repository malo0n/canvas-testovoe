import type { GenerationData } from '@canvas/contracts';
import { call } from '../../api/client';
import { api, type Scenario } from '../../api/endpoints';
import { AppError, hasCode, swallowAppError } from '../../api/errors';
import { ignoreAbort, poll } from '../../api/poll';
import { findFirst } from '../../lib/collections';
import { generationsResource } from '../../store/resources';
import { graphDocument } from '../../store/graph';

/**
 * Запуск и отслеживание генерации.
 *
 * Порядок шагов задан заданием: сначала досохранить граф, затем запустить
 * генерацию его версией, затем дождаться результата. Ожидание идёт через общий
 * опрос, а `AbortController` на пространство останавливает его при закрытии.
 */
const FINAL: ReadonlySet<GenerationData['status']> = new Set(['succeeded', 'failed']);

const isFinished = (generation: GenerationData): boolean => FINAL.has(generation.status);

/** Одно наблюдение на генерацию: повторный запуск опроса не создаётся. */
const watchers = new Map<string, AbortController>();

/**
 * Досохранить правки и запустить генерацию.
 *
 * Учитывает и ещё не сработавший debounce, и уже отправленный запрос
 * сохранения: `flush` снимает таймер и дожидается очереди. Если сохранение не
 * удалось, генерация не запускается — иначе сервер считал бы снимок другого графа.
 */
export async function startGeneration(
  spaceId: string,
  nodeId: string,
  scenario: Scenario,
): Promise<GenerationData> {
  const saved = await graphDocument(spaceId).flush();
  if (saved.error !== undefined || saved.version === undefined) {
    throw (
      saved.error ??
      new AppError({ kind: 'malformed', code: 'UNEXPECTED', message: 'Граф не сохранён.' })
    );
  }

  const started = await createOrResume(spaceId, nodeId, saved.version, scenario);
  upsert(spaceId, started);
  return isFinished(started) ? started : track(spaceId, started);
}

/**
 * Создание запуска с учётом уже идущей генерации у той же ноды.
 *
 * `409 GENERATION_IN_PROGRESS` — не тупик: у ноды уже есть активная попытка,
 * её нужно продолжить отслеживать, а не заводить вторую.
 */
async function createOrResume(
  spaceId: string,
  nodeId: string,
  graphETag: string,
  scenario: Scenario,
): Promise<GenerationData> {
  try {
    const { data } = await call(api.createGeneration, { spaceId, nodeId, graphETag, scenario });
    return data;
  } catch (error) {
    if (!hasCode(error, 'GENERATION_IN_PROGRESS')) throw error;
    const list = await generationsResource.load({ spaceId }, { force: true });
    const running = findFirst(list, (item) => item.nodeId === nodeId && !isFinished(item));
    if (running === undefined) throw error;
    return running;
  }
}

/** Следить за генерацией до конечного статуса. Повторный вызов не дублирует опрос. */
function track(spaceId: string, generation: GenerationData): Promise<GenerationData> {
  const existing = watchers.get(generation.id);
  if (existing !== undefined) return Promise.resolve(generation);
  const controller = new AbortController();
  watchers.set(generation.id, controller);

  return poll<GenerationData>({
    load: (signal) => call(api.getGeneration, { spaceId, generationId: generation.id }, { signal }),
    done: isFinished,
    onValue: (value) => upsert(spaceId, value),
    signal: controller.signal,
  })
    .catch((error: unknown) => {
      ignoreAbort(error);
      return generation;
    })
    .finally(() => {
      watchers.delete(generation.id);
    });
}

/** Продолжить незавершённые генерации: вызывается после открытия пространства. */
export function resumeGenerations(spaceId: string, list: readonly GenerationData[]): void {
  for (let i = 0; i < list.length; i += 1) {
    const generation = list[i]!;
    if (!isFinished(generation)) void track(spaceId, generation).catch(swallowAppError);
  }
}

/** Остановить все опросы: закрытие пространства или уход со страницы. */
export function stopWatching(): void {
  for (const controller of watchers.values()) controller.abort();
  watchers.clear();
}

/**
 * Записать генерацию в список пространства.
 *
 * Список приходит от новых к старым, поэтому новая запись встаёт в начало, а
 * обновление статуса заменяет существующую на месте. Один проход, без
 * промежуточных массивов; неизменившиеся элементы сохраняют прежние ссылки.
 */
function upsert(spaceId: string, generation: GenerationData): void {
  const list = generationsResource.read({ spaceId }).data;
  if (list === undefined) return;

  let index = -1;
  for (let i = 0; i < list.length; i += 1) {
    if (list[i]!.id === generation.id) {
      index = i;
      break;
    }
  }

  const next: GenerationData[] = [];
  if (index === -1) {
    // Новый запуск всегда самый свежий, поэтому встаёт в начало списка.
    next.push(generation);
    for (let i = 0; i < list.length; i += 1) next.push(list[i]!);
  } else {
    const current = list[index]!;
    // Опрос отвечает тем же состоянием, пока идёт обработка: не трогаем список.
    if (current.status === generation.status && current.imageUrl === generation.imageUrl) return;
    for (let i = 0; i < list.length; i += 1) next.push(i === index ? generation : list[i]!);
  }
  generationsResource.put({ spaceId }, next);
}
