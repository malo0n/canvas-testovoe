import { createContext, useContext, type ReactNode } from 'react';
import type { GenerationData } from '@canvas/contracts';
import type { Chain } from './rules';

/**
 * Доступ нод к действиям и производному состоянию.
 *
 * Обработчики и результаты генерации не кладутся в `node.data`: там живут
 * только сохраняемые поля графа. Контекст отдаёт ноде готовое состояние —
 * уже найденную генерацию и уже проверенную цепочку, — поэтому нода ничего
 * не ищет и не пересчитывает при отрисовке.
 */
export type NodeApi = {
  setPromptText: (nodeId: string, text: string) => void;
  removeNode: (nodeId: string) => void;
  runGeneration: (nodeId: string) => void;
  /** Последняя генерация этой ноды результата; список идёт от новых к старым. */
  resultOf: ReadonlyMap<string, GenerationData>;
  /** Активная генерация конкретного генератора. */
  runningOf: ReadonlyMap<string, GenerationData>;
  /** Чего не хватает генератору для запуска. */
  chainOf: ReadonlyMap<string, Chain>;
  /** Генератор, по которому идёт запрос запуска. */
  startingId: string | null;
};

const CanvasApiContext = createContext<NodeApi | null>(null);

export function CanvasApiProvider({ value, children }: { value: NodeApi; children: ReactNode }) {
  return <CanvasApiContext.Provider value={value}>{children}</CanvasApiContext.Provider>;
}

export function useNodeApi(): NodeApi {
  const api = useContext(CanvasApiContext);
  if (api === null) throw new Error('Нода канваса отрисована вне провайдера состояния.');
  return api;
}
