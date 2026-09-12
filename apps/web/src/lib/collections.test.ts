import { describe, expect, it } from 'vitest';
import { findFirst, indexBy, indexByFirst, reconcileById } from './collections';

type Item = { id: string; value: number };
const item = (id: string, value: number): Item => ({ id, value });

describe('обход коллекций за один проход', () => {
  it('строит индекс для обращений по ключу', () => {
    const index = indexBy([item('a', 1), item('b', 2)], (entry) => entry.id);
    expect(index.get('b')?.value).toBe(2);
    expect(index.size).toBe(2);
  });

  it('оставляет первое вхождение: списки API идут от новых к старым', () => {
    const index = indexByFirst([item('a', 3), item('a', 2), item('b', 1)], (entry) => entry.id);
    expect(index.get('a')?.value).toBe(3);
  });

  it('находит первый подходящий элемент', () => {
    const items = [item('a', 1), item('b', 2), item('c', 2)];
    expect(findFirst(items, (entry) => entry.value === 2)?.id).toBe('b');
    expect(findFirst(items, (entry) => entry.value === 9)).toBeUndefined();
  });
});

describe('слияние списка с прежним', () => {
  it('возвращает прежний массив, когда ничего не изменилось', () => {
    const previous = [item('a', 1), item('b', 2)];
    const next = [item('a', 1), item('b', 2)];
    expect(reconcileById(previous, next, (entry) => entry.id)).toBe(previous);
  });

  it('сохраняет ссылки на неизменившиеся элементы', () => {
    const previous = [item('a', 1), item('b', 2)];
    const next = [item('a', 1), item('b', 5)];
    const merged = reconcileById(previous, next, (entry) => entry.id);

    expect(merged[0]).toBe(previous[0]);
    expect(merged[1]).toBe(next[1]);
  });

  it('не создаёт дырок в результате', () => {
    const merged = reconcileById([item('a', 1)], [item('a', 2), item('b', 1)], (e) => e.id);
    expect(Object.keys(merged)).toEqual(['0', '1']);
  });
});
