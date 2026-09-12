import { asString, persisted } from '../lib/storage';

/**
 * Последнее открытое пространство. После перезагрузки страницы приложение
 * возвращает пользователя туда же, а не на пустой список.
 */
const saved = persisted<string | null>('canvas.lastSpace', (raw) => asString(raw) ?? null, null);

export const lastSpace = (): string | null => saved.read();

export const rememberSpace = (spaceId: string): void => saved.write(spaceId);
