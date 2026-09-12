import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureTransport, send } from './transport';
import { AppError } from './errors';

configureTransport({ baseUrl: 'http://api.test', timeoutMs: 1000 });

const stub = (response: Response) => {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

afterEach(() => vi.unstubAllGlobals());

describe('единый механизм отправки запроса', () => {
  it('собирает адрес, заголовки и тело в одном месте', async () => {
    const fetchMock = stub(json({ nodes: [], edges: [] }, { headers: { ETag: '"abc"' } }));

    const result = await send<{ nodes: unknown[] }>({
      method: 'PUT',
      path: '/api/spaces/s1/graph',
      body: { nodes: [], edges: [] },
      headers: { 'If-Match': '"abc"' },
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/api/spaces/s1/graph');
    const headers = new Headers(init.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('If-Match')).toBe('"abc"');
    expect(init.body).toBe('{"nodes":[],"edges":[]}');
    expect(result.data).toEqual({ nodes: [], edges: [] });
    expect(result.etag).toBe('"abc"');
  });

  it('не добавляет тело и Content-Type к чтению', async () => {
    const fetchMock = stub(json([], { headers: { ETag: '"x"' } }));
    await send({ method: 'GET', path: '/api/spaces' });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBeUndefined();
    expect(new Headers(init.headers).has('Content-Type')).toBe(false);
  });

  it('переводит Retry-After и Location в поля результата', async () => {
    stub(
      json(
        { id: 'g1', status: 'processing' },
        {
          status: 202,
          headers: { Location: '/api/spaces/s1/generations/g1', 'Retry-After': '2' },
        },
      ),
    );
    const result = await send({ method: 'POST', path: '/api/spaces/s1/generations', body: {} });
    expect(result.status).toBe(202);
    expect(result.retryAfterMs).toBe(2000);
    expect(result.location).toBe('/api/spaces/s1/generations/g1');
  });

  it('у 304 тело не читается', async () => {
    stub(new Response(null, { status: 304 }));
    const result = await send({ method: 'GET', path: '/api/spaces/s1/graph' });
    expect(result.status).toBe(304);
    expect(result.data).toBeUndefined();
  });
});

describe('приведение ошибок к одному виду', () => {
  it('разбирает тело ошибки API', async () => {
    stub(
      json(
        { error: { code: 'GRAPH_VERSION_CONFLICT', message: 'Граф изменился.' } },
        { status: 412, headers: { 'X-Request-Id': 'r1' } },
      ),
    );

    const error = (await send({ method: 'PUT', path: '/api/spaces/s1/graph', body: {} }).catch(
      (value: unknown) => value,
    )) as AppError;

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('GRAPH_VERSION_CONFLICT');
    expect(error.status).toBe(412);
    expect(error.requestId).toBe('r1');
    expect(error.message).toContain('перечитайте граф');
    expect(error.retryable).toBe(false);
  });

  it('обрыв связи помечается как неопределённый исход записи', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const error = (await send({ method: 'PUT', path: '/api/spaces/s1/graph', body: {} }).catch(
      (value: unknown) => value,
    )) as AppError;

    expect(error.kind).toBe('network');
    expect(error.retryable).toBe(true);
    // Запрос мог дойти до сервера: прежде чем повторять, версию нужно перечитать.
    expect(error.uncertain).toBe(true);
  });

  it('нечитаемое тело не уходит в компонент как данные', async () => {
    stub(new Response('<html>502</html>', { status: 200 }));
    const error = (await send({ method: 'GET', path: '/api/spaces' }).catch(
      (value: unknown) => value,
    )) as AppError;
    expect(error.kind).toBe('malformed');
  });

  it('отмена запроса отличается от ошибки', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        controller.abort();
        throw new DOMException('Aborted', 'AbortError');
      }),
    );
    const error = (await send({
      method: 'GET',
      path: '/api/spaces',
      signal: controller.signal,
    }).catch((value: unknown) => value)) as AppError;
    expect(error.aborted).toBe(true);
  });
});
