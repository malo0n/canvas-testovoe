import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type FinalConnectionState,
  type NodeChange,
  type Viewport,
} from '@xyflow/react';
import type { GraphData } from '@canvas/contracts';
import { graphDocument } from '../../store/graph';
import { useStoreValue } from '../../hooks/useStoreValue';
import type { DocumentState } from '../../store/document';
import {
  createEdge,
  createNode,
  EMPTY_GRAPH,
  projectGraph,
  toCanvasEdges,
  toCanvasNodes,
  type CanvasEdge,
  type CanvasNode,
} from './model';
import {
  indexGraph,
  refuseConnection,
  type ConnectionRefusal,
  type GraphIndex,
  type NodeKind,
} from './rules';

export type Canvas = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: Viewport;
  /** Состояние документа: черновик, сохранение, конфликт, ошибка. */
  document: DocumentState<GraphData>;
  /** Сводка связей графа для проверок; пересчитывается только при изменениях. */
  index: GraphIndex;
  graph: GraphData;
  onNodesChange: (changes: NodeChange<CanvasNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<CanvasEdge>[]) => void;
  onConnect: (connection: Connection) => void;
  /** Разбор неудачной попытки соединения: объясняет, почему связь не создана. */
  onConnectEnd: (event: unknown, state: FinalConnectionState) => void;
  onViewportChange: (viewport: Viewport) => void;
  addNode: (kind: NodeKind, position: { x: number; y: number }) => void;
  removeNode: (nodeId: string) => void;
  setPromptText: (nodeId: string, text: string) => void;
  /** Причина отказа последней попытки соединения — для подсказки в интерфейсе. */
  refusal: ConnectionRefusal | undefined;
  clearRefusal: () => void;
  canConnect: (source: string, target: string) => boolean;
  reloadFromServer: () => Promise<void>;
  retrySave: () => void;
};

/**
 * Состояние канваса одного пространства.
 *
 * React Flow владеет массивами нод и связей вместе со служебными полями
 * (`selected`, `dragging`, `measured`). Постоянная часть уходит в документ
 * через проекцию, которая переиспользует прежние объекты, поэтому служебные
 * изменения не помечают граф изменённым и не вызывают лишних сохранений.
 */
export function useCanvas(spaceId: string, maxEdges: number): Canvas {
  const document = useMemo(() => graphDocument(spaceId), [spaceId]);
  const state = useStoreValue(document.store, identity);

  const [nodes, setNodes] = useState<CanvasNode[]>(NO_NODES);
  const [edges, setEdges] = useState<CanvasEdge[]>(NO_EDGES);
  const [viewport, setViewport] = useState<Viewport>(EMPTY_GRAPH.viewport);
  const [refusal, setRefusal] = useState<ConnectionRefusal | undefined>(undefined);

  // Замена канваса серверным графом — явное действие: открытие пространства
  // или перечитывание после конфликта. Иначе ответ сервера мог бы затереть
  // правки, сделанные во время запроса.
  const adopt = useCallback((graph: GraphData) => {
    setNodes(toCanvasNodes(graph.nodes));
    setEdges(toCanvasEdges(graph.edges));
    setViewport(graph.viewport);
  }, []);

  // Открытие пространства: документ читается один раз, канвас получает его
  // значение. При возврате на страницу берётся уже загруженный документ вместе
  // с несохранёнными правками.
  useEffect(() => {
    let cancelled = false;
    void document.open().then(() => {
      const loaded = document.store.get().value;
      if (!cancelled && loaded !== undefined) adopt(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [document, adopt]);

  // Правки канваса переносятся в документ. Проекция возвращает прежний граф,
  // если сохраняемая часть не изменилась, и тогда документ ничего не планирует.
  useEffect(() => {
    document.edit((current) => projectGraph(current, nodes, edges, viewport));
  }, [document, nodes, edges, viewport]);

  const graph = state.value ?? EMPTY_GRAPH;
  const index = useMemo(() => indexGraph(graph), [graph]);

  // Проверка связи вызывается на каждое движение указателя при перетаскивании,
  // поэтому пользуется готовым индексом и не ищет по массивам.
  const edgeCount = graph.edges.length;
  const refuse = useCallback(
    (source: string, target: string) =>
      refuseConnection(index, edgeCount, maxEdges, source, target),
    [index, edgeCount, maxEdges],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const { source, target } = connection;
      if (source === null || target === null) return;
      const reason = refuse(source, target);
      if (reason !== undefined) {
        setRefusal(reason);
        return;
      }
      setRefusal(undefined);
      setEdges((current) => [...current, createEdge(source, target)]);
    },
    [refuse],
  );

  /**
   * React Flow не создаёт недопустимую связь сам, поэтому `onConnect` при
   * отказе не вызывается. Причину показываем здесь: иначе пользователь видел
   * бы только то, что связь «не прилипла».
   */
  const onConnectEnd = useCallback(
    (_event: unknown, state: FinalConnectionState) => {
      if (state.isValid === true) return;
      const fromSource = state.fromHandle?.type === 'source';
      const source = fromSource ? state.fromNode?.id : state.toNode?.id;
      const target = fromSource ? state.toNode?.id : state.fromNode?.id;
      // Связь бросили на пустое место — объяснять нечего.
      if (source === undefined || target === undefined) return;
      const reason = refuse(source, target);
      if (reason !== undefined) setRefusal(reason);
    },
    [refuse],
  );

  return {
    nodes,
    edges,
    viewport,
    document: state,
    index,
    graph,
    refusal,
    clearRefusal: useCallback(() => setRefusal(undefined), []),
    canConnect: useCallback((source, target) => refuse(source, target) === undefined, [refuse]),

    onNodesChange: useCallback((changes) => {
      // Удаление ноды уносит её связи: иначе сервер отклонит граф со связью
      // на несуществующую ноду.
      let removed: Set<string> | null = null;
      for (let i = 0; i < changes.length; i += 1) {
        const change = changes[i]!;
        if (change.type === 'remove') (removed ??= new Set<string>()).add(change.id);
      }
      setNodes((current) => applyNodeChanges(changes, current));
      if (removed !== null) {
        const gone = removed;
        setEdges((current) => dropEdgesOf(current, gone));
      }
    }, []),
    onEdgesChange: useCallback(
      (changes) => setEdges((current) => applyEdgeChanges(changes, current)),
      [],
    ),
    onConnect,
    onConnectEnd,
    onViewportChange: setViewport,

    addNode: useCallback((kind, position) => {
      setNodes((current) => [...current, createNode(kind, position)]);
    }, []),

    removeNode: useCallback((nodeId) => {
      setNodes((current) => {
        const next: CanvasNode[] = [];
        for (let i = 0; i < current.length; i += 1) {
          if (current[i]!.id !== nodeId) next.push(current[i]!);
        }
        return next.length === current.length ? current : next;
      });
      setEdges((current) => dropEdgesOf(current, new Set([nodeId])));
    }, []),

    setPromptText: useCallback((nodeId, text) => {
      setNodes((current) => replacePrompt(current, nodeId, text));
    }, []),

    reloadFromServer: useCallback(async () => {
      await document.open({ force: true });
      const loaded = document.store.get().value;
      if (loaded !== undefined) adopt(loaded);
    }, [document, adopt]),

    retrySave: useCallback(() => void document.retry(), [document]),
  };
}

/**
 * Замена текста одной ноды.
 *
 * Выполняется на каждое нажатие клавиши, поэтому идёт одним проходом и
 * сохраняет ссылки на остальные ноды: `memo` на нодах React Flow оставляет
 * перерисовку только редактируемой.
 */
function replacePrompt(nodes: readonly CanvasNode[], id: string, text: string): CanvasNode[] {
  const next: CanvasNode[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]!;
    next.push(
      node.id === id && node.type === 'prompt' ? { ...node, data: { ...node.data, text } } : node,
    );
  }
  return next;
}

/**
 * Связи удалённых нод. Один проход; если удалять нечего, возвращается прежний
 * массив, и подписчики не перерисовываются.
 */
function dropEdgesOf(edges: readonly CanvasEdge[], removed: ReadonlySet<string>): CanvasEdge[] {
  const next: CanvasEdge[] = [];
  for (let i = 0; i < edges.length; i += 1) {
    const edge = edges[i]!;
    if (!removed.has(edge.source) && !removed.has(edge.target)) next.push(edge);
  }
  return next.length === edges.length ? (edges as CanvasEdge[]) : next;
}

const NO_NODES: CanvasNode[] = [];
const NO_EDGES: CanvasEdge[] = [];
const identity = <T>(value: T): T => value;
