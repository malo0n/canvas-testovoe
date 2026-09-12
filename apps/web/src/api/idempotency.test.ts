import { describe, expect, it } from 'vitest';
import { fingerprintOf, idempotencyKeyFor, resetIdempotency } from './idempotency';

describe('ключи идемпотентности', () => {
  it('повтор с тем же телом сохраняет ключ, изменение данных даёт новый', () => {
    resetIdempotency();
    const scope = 'generation:s1:g1';
    const body = ['g1', '"etag-1"', 'success'];
    const first = idempotencyKeyFor({ scope, fingerprint: fingerprintOf(body) });
    expect(idempotencyKeyFor({ scope, fingerprint: fingerprintOf(body) })).toBe(first);

    // Другая версия графа — другой запуск.
    const newer = idempotencyKeyFor({
      scope,
      fingerprint: fingerprintOf(['g1', '"etag-2"', 'success']),
    });
    expect(newer).not.toBe(first);

    // Другой сценарий — тоже другой запуск.
    const failing = idempotencyKeyFor({
      scope,
      fingerprint: fingerprintOf(['g1', '"etag-2"', 'failure']),
    });
    expect(failing).not.toBe(newer);
  });

  it('порядок полей в теле не влияет на отпечаток', () => {
    expect(fingerprintOf({ a: 1, b: { c: 2, d: 3 } })).toBe(
      fingerprintOf({ b: { d: 3, c: 2 }, a: 1 }),
    );
  });

  it('запуски разных нод не делят ключ', () => {
    resetIdempotency();
    const one = idempotencyKeyFor({ scope: 'generation:s1:g1', fingerprint: 'x' });
    const two = idempotencyKeyFor({ scope: 'generation:s1:g2', fingerprint: 'x' });
    expect(two).not.toBe(one);
  });
});
