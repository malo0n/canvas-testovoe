import type { DocumentState, SaveStatus } from '../../store/document';
import type { GraphData } from '@canvas/contracts';

/**
 * Как показывается состояние сохранения.
 *
 * Одна таблица на всё приложение: панель состояния и кнопки берут текст и
 * оформление отсюда, а не решают заново, что значит каждый статус.
 */
export type SaveTone = 'neutral' | 'progress' | 'ok' | 'warn' | 'error';

export type SaveView = { text: string; tone: SaveTone; busy: boolean };

const VIEWS: Readonly<Record<SaveStatus, SaveView>> = {
  idle: { text: 'Готово к работе', tone: 'neutral', busy: false },
  pending: { text: 'Есть несохранённые правки', tone: 'warn', busy: false },
  saving: { text: 'Сохраняем…', tone: 'progress', busy: true },
  saved: { text: 'Все правки сохранены', tone: 'ok', busy: false },
  error: { text: 'Не удалось сохранить', tone: 'error', busy: false },
  conflict: { text: 'Версии разошлись', tone: 'error', busy: false },
};

export function describeSave(state: DocumentState<GraphData>): SaveView {
  if (state.loading) return { text: 'Загружаем граф…', tone: 'progress', busy: true };
  const view = VIEWS[state.status];
  // Правка во время запроса: сохранение идёт, но уже не последнее состояние.
  if (state.status === 'saving' && state.dirty) {
    return { text: 'Сохраняем, есть новые правки', tone: 'progress', busy: true };
  }
  return view;
}
