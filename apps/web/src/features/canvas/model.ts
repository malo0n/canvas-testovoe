import type { Edge, Node, Viewport } from '@xyflow/react';
import type { GraphData } from '@canvas/contracts';
import type { GraphEdge, GraphNode, NodeKind } from './rules';
import { TITLES } from './rules';

/**
 * Типы канваса и перевод между представлением React Flow и графом API.
 *
 * Постоянные данные графа отделены от служебных полей React Flow: `selected`,
 * `dragging`, `measured` и обработчики живут только в объектах канваса и
 * никогда не попадают в запрос.
 */
export type PromptNode = Node<{ text: string }, 'prompt'>;
export type GeneratorNode = Node<{ label: string }, 'generator'>;
export type ResultNode = Node<{ label: string }, 'result'>;
export type CanvasNode = PromptNode | GeneratorNode | ResultNode;
export type CanvasEdge = Edge;

/** Допустимая область для нод: совпадает с ограничением схемы API. */
export const NODE_EXTENT: [[number, number], [number, number]] = [
  [-10000, -10000],
  [10000, 10000],
];
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

export const EMPTY_GRAPH: GraphData = {
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

export function createNode(kind: NodeKind, position: { x: number; y: number }): CanvasNode {
  const id = crypto.randomUUID();
  const at = { x: clamp(position.x), y: clamp(position.y) };
  return kind === 'prompt'
    ? { id, type: 'prompt', position: at, data: { text: '' } }
    : { id, type: kind, position: at, data: { label: TITLES[kind] } };
}

const clamp = (value: number) => Math.min(10000, Math.max(-10000, Math.round(value)));

export const createEdge = (source: string, target: string): CanvasEdge => ({
  id: crypto.randomUUID(),
  source,
  target,
});

/** Граф API -> ноды канваса. Выполняется только при открытии и перечитывании. */
export function toCanvasNodes(nodes: readonly GraphNode[]): CanvasNode[] {
  const result: CanvasNode[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]!;
    result.push(
      node.type === 'prompt'
        ? { id: node.id, type: 'prompt', position: node.position, data: { text: node.data.text } }
        : {
            id: node.id,
            type: node.type,
            position: node.position,
            data: { label: node.data.label },
          },
    );
  }
  return result;
}

export function toCanvasEdges(edges: readonly GraphEdge[]): CanvasEdge[] {
  const result: CanvasEdge[] = [];
  for (let i = 0; i < edges.length; i += 1) {
    const edge = edges[i]!;
    result.push({ id: edge.id, source: edge.source, target: edge.target });
  }
  return result;
}

/**
 * Ноды канваса -> граф API.
 *
 * Самая частая обработка в приложении: React Flow сообщает об изменениях на
 * каждое движение указателя при перетаскивании, и после каждого нужно понять,
 * изменились ли сохраняемые данные.
 *
 * Поэтому проекция идёт одним проходом по нодам и одним по связям, переиспользуя
 * объекты прежнего графа для всего, что не изменилось. Если не изменилось
 * ничего, возвращается прежний граф целиком — документ не считает это правкой и
 * не планирует лишнее сохранение. Именно это отсекает служебные изменения вроде
 * `measured` и `selected`, которые приходят пачками, но графа не меняют.
 */
export function projectGraph(
  previous: GraphData,
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  viewport: Viewport,
): GraphData {
  const previousNodes = indexNodes(previous.nodes);
  const nextNodes: GraphNode[] = [];
  let nodesChanged = previous.nodes.length !== nodes.length;
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]!;
    const kept = previousNodes.get(node.id);
    const value = kept !== undefined && sameNode(kept, node) ? kept : toGraphNode(node);
    if (!nodesChanged && value !== previous.nodes[i]) nodesChanged = true;
    nextNodes.push(value);
  }

  const previousEdges = indexEdges(previous.edges);
  const nextEdges: GraphEdge[] = [];
  let edgesChanged = previous.edges.length !== edges.length;
  for (let i = 0; i < edges.length; i += 1) {
    const edge = edges[i]!;
    const kept = previousEdges.get(edge.id);
    const value =
      kept !== undefined && kept.source === edge.source && kept.target === edge.target
        ? kept
        : { id: edge.id, source: edge.source, target: edge.target };
    if (!edgesChanged && value !== previous.edges[i]) edgesChanged = true;
    nextEdges.push(value);
  }

  const viewportChanged =
    previous.viewport.x !== viewport.x ||
    previous.viewport.y !== viewport.y ||
    previous.viewport.zoom !== viewport.zoom;

  if (!nodesChanged && !edgesChanged && !viewportChanged) return previous;
  return {
    nodes: nodesChanged ? nextNodes : previous.nodes,
    edges: edgesChanged ? nextEdges : previous.edges,
    viewport: viewportChanged
      ? { x: viewport.x, y: viewport.y, zoom: viewport.zoom }
      : previous.viewport,
  };
}

function indexNodes(nodes: readonly GraphNode[]): Map<string, GraphNode> {
  const index = new Map<string, GraphNode>();
  for (let i = 0; i < nodes.length; i += 1) index.set(nodes[i]!.id, nodes[i]!);
  return index;
}

function indexEdges(edges: readonly GraphEdge[]): Map<string, GraphEdge> {
  const index = new Map<string, GraphEdge>();
  for (let i = 0; i < edges.length; i += 1) index.set(edges[i]!.id, edges[i]!);
  return index;
}

function sameNode(previous: GraphNode, node: CanvasNode): boolean {
  if (previous.type !== node.type) return false;
  if (previous.position.x !== node.position.x || previous.position.y !== node.position.y) {
    return false;
  }
  return previous.type === 'prompt'
    ? previous.data.text === (node.data as { text: string }).text
    : previous.data.label === (node.data as { label: string }).label;
}

function toGraphNode(node: CanvasNode): GraphNode {
  const position = { x: node.position.x, y: node.position.y };
  return node.type === 'prompt'
    ? { id: node.id, type: 'prompt', position, data: { text: node.data.text } }
    : { id: node.id, type: node.type, position, data: { label: node.data.label } };
}
