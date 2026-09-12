import { describe, expect, it } from 'vitest';
import type { GraphData } from '@canvas/contracts';
import { indexGraph, inspectChain, refuseConnection } from './rules';

const at = { x: 0, y: 0 };

const graph = (text = 'Горы'): GraphData => ({
  nodes: [
    { id: 'p1', type: 'prompt', position: at, data: { text } },
    { id: 'p2', type: 'prompt', position: at, data: { text: 'Другой' } },
    { id: 'g1', type: 'generator', position: at, data: { label: 'Генератор' } },
    { id: 'g2', type: 'generator', position: at, data: { label: 'Генератор' } },
    { id: 'r1', type: 'result', position: at, data: { label: 'Результат' } },
    { id: 'r2', type: 'result', position: at, data: { label: 'Результат' } },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});

const withEdges = (edges: GraphData['edges'], text?: string): GraphData => ({
  ...graph(text),
  edges,
});

describe('правила связей', () => {
  it('разрешает только текст → генератор и генератор → результат', () => {
    const index = indexGraph(graph());
    expect(refuseConnection(index, 0, 20, 'p1', 'g1')).toBeUndefined();
    expect(refuseConnection(index, 0, 20, 'g1', 'r1')).toBeUndefined();
    expect(refuseConnection(index, 0, 20, 'p1', 'r1')).toBe('WRONG_TYPES');
    expect(refuseConnection(index, 0, 20, 'g1', 'p1')).toBe('WRONG_TYPES');
    expect(refuseConnection(index, 0, 20, 'r1', 'g1')).toBe('WRONG_TYPES');
    expect(refuseConnection(index, 0, 20, 'g1', 'g2')).toBe('WRONG_TYPES');
  });

  it('у каждого входа одна связь', () => {
    const index = indexGraph(withEdges([{ id: 'e1', source: 'p1', target: 'g1' }]));
    expect(refuseConnection(index, 1, 20, 'p2', 'g1')).toBe('INPUT_TAKEN');
    expect(refuseConnection(index, 1, 20, 'p1', 'g2')).toBeUndefined();
  });

  it('у генератора один результат, а текст можно использовать несколькими', () => {
    const index = indexGraph(
      withEdges([
        { id: 'e1', source: 'p1', target: 'g1' },
        { id: 'e2', source: 'g1', target: 'r1' },
      ]),
    );
    expect(refuseConnection(index, 2, 20, 'g1', 'r2')).toBe('OUTPUT_TAKEN');
    // Тот же текст — другому генератору: это разрешено.
    expect(refuseConnection(index, 2, 20, 'p1', 'g2')).toBeUndefined();
  });

  it('нода не соединяется сама с собой и с исчезнувшей нодой', () => {
    const index = indexGraph(graph());
    expect(refuseConnection(index, 0, 20, 'g1', 'g1')).toBe('SAME_NODE');
    expect(refuseConnection(index, 0, 20, 'g1', 'нет-такой')).toBe('UNKNOWN_NODE');
  });

  it('предел связей совпадает с ограничением сервера', () => {
    const index = indexGraph(graph());
    expect(refuseConnection(index, 20, 20, 'p1', 'g1')).toBe('TOO_MANY_EDGES');
  });
});

describe('готовность цепочки к запуску', () => {
  const chainEdges = [
    { id: 'e1', source: 'p1', target: 'g1' },
    { id: 'e2', source: 'g1', target: 'r1' },
  ];

  it('полная цепочка с непустым текстом готова', () => {
    const data = withEdges(chainEdges);
    const chain = inspectChain(indexGraph(data), 'g1');
    expect(chain.problem).toBeUndefined();
    expect(chain.promptId).toBe('p1');
    expect(chain.resultId).toBe('r1');
  });

  it('называет, чего именно не хватает', () => {
    expect(inspectChain(indexGraph(graph()), 'g1').problem).toBe('NO_PROMPT');
    expect(
      inspectChain(indexGraph(withEdges([{ id: 'e1', source: 'p1', target: 'g1' }])), 'g1').problem,
    ).toBe('NO_RESULT');
    expect(inspectChain(indexGraph(withEdges(chainEdges, '   ')), 'g1').problem).toBe(
      'EMPTY_PROMPT',
    );
  });
});
