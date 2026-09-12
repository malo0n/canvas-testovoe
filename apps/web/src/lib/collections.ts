/**
 * Общие приёмы работы с коллекциями, которые в приложении встречаются часто.
 * Все они сделаны за один проход и без промежуточных массивов.
 */

/**
 * Индекс по ключу для последующих обращений.
 *
 * Строится один раз на набор данных и переиспользуется, вместо поиска `find`
 * внутри обхода: иначе стоимость была бы O(n·m) при каждом обращении.
 */
export function indexBy<T, K>(items: readonly T[], keyOf: (item: T) => K): Map<K, T> {
  const index = new Map<K, T>();
  for (let i = 0; i < items.length; i += 1) index.set(keyOf(items[i]!), items[i]!);
  return index;
}

/**
 * Индекс по ключу, оставляющий первое вхождение.
 *
 * Списки API идут от новых к старым, поэтому первое вхождение — самое свежее:
 * отдельная сортировка или сравнение дат не нужны.
 */
export function indexByFirst<T, K>(items: readonly T[], keyOf: (item: T) => K): Map<K, T> {
  const index = new Map<K, T>();
  for (let i = 0; i < items.length; i += 1) {
    const key = keyOf(items[i]!);
    if (!index.has(key)) index.set(key, items[i]!);
  }
  return index;
}

/** Первый подходящий элемент: строить весь список отфильтрованных незачем. */
export function findFirst<T>(items: readonly T[], match: (item: T) => boolean): T | undefined {
  for (let i = 0; i < items.length; i += 1) {
    if (match(items[i]!)) return items[i]!;
  }
  return undefined;
}

const shallowEqual = (a: object, b: object): boolean => {
  if (a === b) return true;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i]!;
    if ((a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key]) return false;
  }
  return true;
};

/**
 * Слияние нового списка с прежним по идентификатору.
 *
 * Ответ сервера приходит целиком, но меняется обычно одна запись. Здесь
 * сохраняются ссылки на неизменившиеся элементы, а если не изменилось ничего —
 * возвращается прежний массив.
 *
 * Стоимость: одна `Map` по прежнему списку и один проход по новому.
 */
export function reconcileById<T extends object>(
  previous: readonly T[] | undefined,
  next: readonly T[],
  keyOf: (item: T) => string,
): readonly T[] {
  if (previous === undefined || previous === next) return next;
  if (next.length === 0) return previous.length === 0 ? previous : next;
  if (previous.length === 0) return next;

  const index = indexBy(previous, keyOf);
  const merged: T[] = [];
  let changed = previous.length !== next.length;
  for (let i = 0; i < next.length; i += 1) {
    const item = next[i]!;
    const kept = index.get(keyOf(item));
    const value = kept !== undefined && shallowEqual(kept, item) ? kept : item;
    if (!changed && value !== previous[i]) changed = true;
    merged.push(value);
  }
  return changed ? merged : previous;
}
