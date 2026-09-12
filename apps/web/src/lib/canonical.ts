/**
 * Стабильное представление значения в виде строки: ключи объектов
 * упорядочены, поэтому одинаковые по смыслу тела дают одинаковый результат.
 *
 * Нужно для отпечатков тела запроса — по ним решается, повтор это прежнего
 * запроса (тот же ключ идемпотентности) или новый запуск (новый ключ), — и
 * для ключей кэша ресурсов.
 */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) {
    let out = '[';
    for (let i = 0; i < value.length; i += 1) {
      if (i > 0) out += ',';
      out += canonical(value[i]);
    }
    return `${out}]`;
  }
  const keys = Object.keys(value as object).sort();
  let out = '{';
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i]!;
    const item = (value as Record<string, unknown>)[key];
    if (item === undefined) continue;
    if (out.length > 1) out += ',';
    out += `${JSON.stringify(key)}:${canonical(item)}`;
  }
  return `${out}}`;
}
