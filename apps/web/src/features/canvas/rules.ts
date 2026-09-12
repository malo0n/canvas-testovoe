import type { GraphData, NodeData } from '@canvas/contracts';

export type NodeKind = NodeData['type'];
export type GraphNode = GraphData['nodes'][number];
export type GraphEdge = GraphData['edges'][number];

/**
 * Правила цепочки «текст → генератор → результат» — в одном месте.
 *
 * Ими пользуются проверка во время перетаскивания связи, создание связи,
 * подсказки в интерфейсе и признак готовности генератора к запуску.
 * Расхождения между этими местами невозможны: реализация одна.
 */
const ALLOWED: Readonly<Record<NodeKind, NodeKind | null>> = {
  prompt: 'generator',
  generator: 'result',
  result: null,
};

export const TITLES: Readonly<Record<NodeKind, string>> = {
  prompt: 'Текст',
  generator: 'Генератор',
  result: 'Результат',
};

/** Запасные значения на случай, если `GET /api/config` ещё не ответил. */
export const MAX_NODES = 20;
export const MAX_EDGES = 20;

/**
 * Сводка графа для всех проверок.
 *
 * Строится один раз на новый граф: один проход по нодам и один по связям.
 * Дальше любая проверка — обращение по ключу. Это важно, потому что проверка
 * допустимости связи вызывается на каждое движение указателя во время
 * перетаскивания, а состояние генераторов пересчитывается на каждую правку.
 */
export type GraphIndex = {
  readonly kindById: ReadonlyMap<string, NodeKind>;
  /** Тексты промптов: нужны, чтобы понять, готова ли цепочка к запуску. */
  readonly textById: ReadonlyMap<string, string>;
  /** Вход -> источник. У каждого входа одна связь, поэтому значение одно. */
  readonly incoming: ReadonlyMap<string, string>;
  /** Генератор -> его нода результата. У генератора один результат. */
  readonly resultOf: ReadonlyMap<string, string>;
};

export function indexGraph(graph: GraphData): GraphIndex {
  const kindById = new Map<string, NodeKind>();
  const textById = new Map<string, string>();
  for (let i = 0; i < graph.nodes.length; i += 1) {
    const node = graph.nodes[i]!;
    kindById.set(node.id, node.type);
    if (node.type === 'prompt') textById.set(node.id, node.data.text);
  }

  const incoming = new Map<string, string>();
  const resultOf = new Map<string, string>();
  for (let i = 0; i < graph.edges.length; i += 1) {
    const edge = graph.edges[i]!;
    incoming.set(edge.target, edge.source);
    if (kindById.get(edge.source) === 'generator') resultOf.set(edge.source, edge.target);
  }

  return { kindById, textById, incoming, resultOf };
}

export type ConnectionRefusal =
  'SAME_NODE' | 'UNKNOWN_NODE' | 'WRONG_TYPES' | 'INPUT_TAKEN' | 'OUTPUT_TAKEN' | 'TOO_MANY_EDGES';

/** Причины отказа словами: одно сообщение на все места показа. */
export const REFUSAL_TEXT: Readonly<Record<ConnectionRefusal, string>> = {
  SAME_NODE: 'Нода не соединяется сама с собой.',
  UNKNOWN_NODE: 'Одна из нод больше не существует.',
  WRONG_TYPES: 'Допустимы только связи «текст → генератор» и «генератор → результат».',
  INPUT_TAKEN: 'У входа уже есть связь. Сначала удалите прежнюю.',
  OUTPUT_TAKEN: 'У генератора уже есть нода результата.',
  TOO_MANY_EDGES: 'Больше связей сервер не примет.',
};

/**
 * Можно ли соединить две ноды. `undefined` означает «можно», иначе причина.
 * Вызывается очень часто, поэтому работает только по готовому индексу.
 */
export function refuseConnection(
  index: GraphIndex,
  edgeCount: number,
  maxEdges: number,
  source: string,
  target: string,
): ConnectionRefusal | undefined {
  if (source === target) return 'SAME_NODE';
  const from = index.kindById.get(source);
  const to = index.kindById.get(target);
  if (from === undefined || to === undefined) return 'UNKNOWN_NODE';
  if (ALLOWED[from] !== to) return 'WRONG_TYPES';
  if (index.incoming.has(target)) return 'INPUT_TAKEN';
  if (from === 'generator' && index.resultOf.has(source)) return 'OUTPUT_TAKEN';
  if (edgeCount >= maxEdges) return 'TOO_MANY_EDGES';
  return undefined;
}

export type ChainProblem = 'NO_PROMPT' | 'EMPTY_PROMPT' | 'NO_RESULT';

export const CHAIN_TEXT: Readonly<Record<ChainProblem, string>> = {
  NO_PROMPT: 'Соедините текстовую ноду с этим генератором.',
  EMPTY_PROMPT: 'Заполните текст в связанной текстовой ноде.',
  NO_RESULT: 'Соедините генератор с нодой результата.',
};

export type Chain = {
  readonly problem: ChainProblem | undefined;
  readonly promptId: string | undefined;
  readonly resultId: string | undefined;
};

/**
 * Готовность генератора к запуску: тот же набор условий, что проверяет сервер.
 * Проверка выполняется до запроса, поэтому кнопка объясняет, чего не хватает,
 * вместо ответа `422 INCOMPLETE_CHAIN`.
 */
export function inspectChain(index: GraphIndex, generatorId: string): Chain {
  const promptId = index.incoming.get(generatorId);
  const resultId = index.resultOf.get(generatorId);
  if (promptId === undefined || index.kindById.get(promptId) !== 'prompt') {
    return { problem: 'NO_PROMPT', promptId: undefined, resultId };
  }
  if ((index.textById.get(promptId) ?? '').trim().length === 0) {
    return { problem: 'EMPTY_PROMPT', promptId, resultId };
  }
  if (resultId === undefined) return { problem: 'NO_RESULT', promptId, resultId: undefined };
  return { problem: undefined, promptId, resultId };
}
