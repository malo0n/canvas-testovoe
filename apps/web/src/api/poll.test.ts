import { describe, expect, it, vi } from 'vitest';
import { poll } from './poll';
import type { Result } from './transport';

const result = <T>(data: T, retryAfterMs?: number): Result<T> => ({
  data,
  status: 200,
  requestId: undefined,
  etag: undefined,
  location: undefined,
  retryAfterMs,
});

describe('общий опрос состояния', () => {
  it('запрашивает статус до конечного значения и не чаще одного раза за шаг', async () => {
    const statuses = ['processing', 'processing', 'succeeded'];
    let index = 0;
    const load = vi.fn(async () => result({ status: statuses[index++]! }, 0));
    const seen: string[] = [];

    const final = await poll({
      load,
      done: (value) => value.status === 'succeeded',
      onValue: (value) => seen.push(value.status),
      signal: new AbortController().signal,
      intervalMs: 0,
    });

    expect(final.status).toBe('succeeded');
    expect(load).toHaveBeenCalledTimes(3);
    expect(seen).toEqual(statuses);
  });

  it('прекращает опрос по сигналу и не делает лишних запросов', async () => {
    const controller = new AbortController();
    const load = vi.fn(async () => {
      controller.abort();
      return result({ status: 'processing' }, 0);
    });

    await expect(
      poll({
        load,
        done: (value) => value.status === 'succeeded',
        signal: controller.signal,
        intervalMs: 0,
      }),
    ).rejects.toMatchObject({ kind: 'aborted' });

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('отдаёт последнее значение, когда состояние так и не стало конечным', async () => {
    const load = vi.fn(async () => result({ status: 'processing' }, 0));
    const final = await poll({
      load,
      done: (value) => value.status === 'succeeded',
      signal: new AbortController().signal,
      intervalMs: 0,
      timeoutMs: 0,
    });
    expect(final.status).toBe('processing');
    expect(load).toHaveBeenCalledTimes(1);
  });
});
