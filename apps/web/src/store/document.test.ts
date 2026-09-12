import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocument, type Versioned } from './document';
import { AppError } from '../api/errors';

type Doc = { text: string };

const DEBOUNCE = 500;

/** Управляемое сохранение: тест решает, когда запрос завершится. */
function controllable() {
  const calls: { value: Doc; version: string; settle: (version: string) => void }[] = [];
  const save = (value: Doc, version: string): Promise<Versioned<Doc>> =>
    new Promise((resolve) => {
      calls.push({
        value,
        version,
        settle: (next) => resolve({ value, version: next }),
      });
    });
  return { calls, save };
}

const loaded =
  (text: string, version = 'v1') =>
  async () => ({ value: { text }, version });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('документ с отложенным сохранением', () => {
  it('серия быстрых правок даёт одно сохранение после паузы', async () => {
    const save = vi.fn(async (value: Doc, version: string) => ({ value, version: `${version}+` }));
    const document = createDocument<Doc>({ load: loaded('a'), save, debounceMs: DEBOUNCE });
    await document.open();

    document.edit(() => ({ text: 'b' }));
    document.edit(() => ({ text: 'bc' }));
    document.edit(() => ({ text: 'bcd' }));
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0]).toEqual({ text: 'bcd' });
    expect(document.store.get().status).toBe('saved');
    expect(document.store.get().dirty).toBe(false);
  });

  it('одиночная правка тоже сохраняется', async () => {
    const save = vi.fn(async (value: Doc, version: string) => ({ value, version: `${version}+` }));
    const document = createDocument<Doc>({ load: loaded('a'), save, debounceMs: DEBOUNCE });
    await document.open();

    document.edit(() => ({ text: 'b' }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('правки во время запроса ждут очереди и уходят следующим сохранением', async () => {
    const { calls, save } = controllable();
    const document = createDocument<Doc>({ load: loaded('a'), save, debounceMs: DEBOUNCE });
    await document.open();

    document.edit(() => ({ text: 'first' }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.version).toBe('v1');

    // Пока первый запрос не ответил, второго не начинается.
    document.edit(() => ({ text: 'second' }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(calls).toHaveLength(1);

    calls[0]!.settle('v2');
    await vi.advanceTimersByTimeAsync(0);

    expect(calls).toHaveLength(2);
    // Следующее сохранение берёт версию из ответа предыдущего.
    expect(calls[1]!.version).toBe('v2');
    expect(calls[1]!.value).toEqual({ text: 'second' });
  });

  it('ответ прежнего запроса не подменяет более свежие правки', async () => {
    const { calls, save } = controllable();
    const document = createDocument<Doc>({ load: loaded('a'), save, debounceMs: DEBOUNCE });
    await document.open();

    document.edit(() => ({ text: 'sent' }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    document.edit(() => ({ text: 'newer' }));

    calls[0]!.settle('v2');
    await vi.advanceTimersByTimeAsync(0);

    // Значение осталось локальным, из ответа взята только версия.
    expect(document.store.get().value).toEqual({ text: 'newer' });
    expect(document.store.get().version).toBe('v2');
  });

  it('flush снимает таймер и дожидается отправки последних правок', async () => {
    const save = vi.fn(async (value: Doc, version: string) => ({ value, version: `${version}+` }));
    const document = createDocument<Doc>({ load: loaded('a'), save, debounceMs: DEBOUNCE });
    await document.open();

    document.edit(() => ({ text: 'b' }));
    const settled = document.flush();
    await vi.advanceTimersByTimeAsync(0);
    const state = await settled;

    expect(save).toHaveBeenCalledTimes(1);
    expect(state.dirty).toBe(false);
    expect(state.version).toBe('v1+');
  });

  it('конфликт версий сохраняет черновик и останавливает автосохранение', async () => {
    const save = vi.fn(async () => {
      throw new AppError({
        kind: 'http',
        status: 412,
        code: 'GRAPH_VERSION_CONFLICT',
        message: 'конфликт',
      });
    });
    const document = createDocument<Doc>({ load: loaded('a'), save, debounceMs: DEBOUNCE });
    await document.open();

    document.edit(() => ({ text: 'моя правка' }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE);

    const state = document.store.get();
    expect(state.status).toBe('conflict');
    expect(state.value).toEqual({ text: 'моя правка' });
    expect(state.dirty).toBe(true);

    // Дальнейшие правки не уходят на сервер, пока конфликт не разрешён.
    document.edit(() => ({ text: 'ещё правка' }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 4);
    expect(save).toHaveBeenCalledTimes(1);
    expect(document.store.get().value).toEqual({ text: 'ещё правка' });
  });

  it('перечитывание заменяет черновик серверным значением', async () => {
    let version = 'v1';
    const document = createDocument<Doc>({
      load: async () => ({ value: { text: `сервер ${version}` }, version }),
      save: async (value, current) => ({ value, version: current }),
      debounceMs: DEBOUNCE,
    });
    await document.open();
    document.edit(() => ({ text: 'локальная' }));

    version = 'v2';
    await document.open({ force: true });

    expect(document.store.get().value).toEqual({ text: 'сервер v2' });
    expect(document.store.get().version).toBe('v2');
    expect(document.store.get().dirty).toBe(false);
  });

  it('сетевая ошибка оставляет правки несохранёнными и допускает повтор', async () => {
    let fail = true;
    const save = vi.fn(async (value: Doc, version: string) => {
      if (fail) throw new AppError({ kind: 'network', code: 'NETWORK', message: 'нет связи' });
      return { value, version: `${version}+` };
    });
    const document = createDocument<Doc>({ load: loaded('a'), save, debounceMs: DEBOUNCE });
    await document.open();

    document.edit(() => ({ text: 'b' }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE);

    expect(document.store.get().status).toBe('error');
    expect(document.store.get().dirty).toBe(true);
    expect(document.store.get().value).toEqual({ text: 'b' });

    fail = false;
    await document.retry();
    expect(document.store.get().status).toBe('saved');
    expect(document.store.get().dirty).toBe(false);
  });

  it('правка, не изменившая значение, ничего не планирует', async () => {
    const save = vi.fn(async (value: Doc, version: string) => ({ value, version }));
    const document = createDocument<Doc>({ load: loaded('a'), save, debounceMs: DEBOUNCE });
    await document.open();

    document.edit((current) => current);
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 2);

    expect(save).not.toHaveBeenCalled();
    expect(document.store.get().dirty).toBe(false);
  });
});
