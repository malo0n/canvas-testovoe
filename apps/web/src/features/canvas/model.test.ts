import { describe, expect, it } from 'vitest';
import type { GraphData } from '@canvas/contracts';
import { projectGraph, toCanvasEdges, toCanvasNodes, type CanvasNode } from './model';

const graph: GraphData = {
  nodes: [
    { id: 'p1', type: 'prompt', position: { x: 10, y: 20 }, data: { text: 'Горы' } },
    { id: 'g1', type: 'generator', position: { x: 300, y: 20 }, data: { label: 'Генератор' } },
  ],
  edges: [{ id: 'e1', source: 'p1', target: 'g1' }],
  viewport: { x: 0, y: 0, zoom: 1 },
};

/** Служебные поля React Flow: сохраняться они не должны. */
const withService = (nodes: CanvasNode[]): CanvasNode[] =>
  nodes.map((node) => ({
    ...node,
    selected: true,
    dragging: false,
    measured: { width: 260, height: 180 },
  }));

describe('проекция канваса в граф API', () => {
  it('служебные поля React Flow не считаются правкой', () => {
    const nodes = withService(toCanvasNodes(graph.nodes));
    const edges = toCanvasEdges(graph.edges);
    expect(projectGraph(graph, nodes, edges, graph.viewport)).toBe(graph);
  });

  it('перемещение одной ноды не пересоздаёт остальные', () => {
    const nodes = toCanvasNodes(graph.nodes);
    nodes[1] = { ...nodes[1]!, position: { x: 320, y: 40 } } as CanvasNode;
    const next = projectGraph(graph, nodes, toCanvasEdges(graph.edges), graph.viewport);

    expect(next).not.toBe(graph);
    expect(next.nodes[0]).toBe(graph.nodes[0]);
    expect(next.nodes[1]!.position).toEqual({ x: 320, y: 40 });
    // Связи и viewport не менялись — ссылки прежние.
    expect(next.edges).toBe(graph.edges);
    expect(next.viewport).toBe(graph.viewport);
  });

  it('текст ноды попадает в граф, служебные поля — нет', () => {
    const nodes = withService(toCanvasNodes(graph.nodes));
    nodes[0] = { ...nodes[0]!, data: { text: 'Море' } } as CanvasNode;
    const next = projectGraph(graph, nodes, toCanvasEdges(graph.edges), graph.viewport);

    expect(next.nodes[0]).toEqual({
      id: 'p1',
      type: 'prompt',
      position: { x: 10, y: 20 },
      data: { text: 'Море' },
    });
    expect(Object.keys(next.nodes[0]!)).toEqual(['id', 'type', 'position', 'data']);
  });

  it('изменение канваса виден в связях и положении', () => {
    const nodes = toCanvasNodes(graph.nodes);
    const next = projectGraph(graph, nodes, [], { x: 5, y: 6, zoom: 1.5 });
    expect(next.edges).toEqual([]);
    expect(next.viewport).toEqual({ x: 5, y: 6, zoom: 1.5 });
    expect(next.nodes).toBe(graph.nodes);
  });

  it('результат остаётся плотным массивом без дырок', () => {
    const nodes = toCanvasNodes(graph.nodes);
    nodes[0] = { ...nodes[0]!, position: { x: 1, y: 1 } } as CanvasNode;
    const next = projectGraph(graph, nodes, toCanvasEdges(graph.edges), graph.viewport);
    expect(Object.keys(next.nodes)).toEqual(['0', '1']);
    expect(next.nodes.every((node) => node !== undefined)).toBe(true);
  });
});
