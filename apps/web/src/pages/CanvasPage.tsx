import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type IsValidConnection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { GenerationData } from '@canvas/contracts';
import { useResource } from '../hooks/useResource';
import { useAction } from '../hooks/useAction';
import { configResource, generationsResource, spaceResource } from '../store/resources';
import { rememberSpace } from '../store/lastSpace';
import { indexByFirst } from '../lib/collections';
import { useCanvas } from '../features/canvas/useCanvas';
import { CanvasApiProvider, type NodeApi } from '../features/canvas/context';
import { NODE_TYPES } from '../features/canvas/nodes';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  NODE_EXTENT,
  type CanvasEdge,
  type CanvasNode,
} from '../features/canvas/model';
import {
  inspectChain,
  MAX_EDGES,
  MAX_NODES,
  REFUSAL_TEXT,
  TITLES,
  type Chain,
  type NodeKind,
} from '../features/canvas/rules';
import { describeSave } from '../features/canvas/status';
import { resumeGenerations, startGeneration, stopWatching } from '../features/generation/runner';
import { Alert, Button, ErrorAlert } from '../ui';
import { motion, SPRING } from '../ui/motion';
import ui from '../ui/ui.module.css';
import styles from './canvas.module.css';

export function CanvasPage() {
  return (
    <ReactFlowProvider>
      <CanvasScreen />
    </ReactFlowProvider>
  );
}

const SCENARIOS = [
  { value: 'success', title: 'Успешная генерация' },
  { value: 'failure', title: 'Тестовый отказ' },
] as const;

function CanvasScreen() {
  const { spaceId = '' } = useParams();
  const space = useResource(spaceResource, { spaceId }, { enabled: spaceId !== '' });
  const generations = useResource(generationsResource, { spaceId }, { enabled: spaceId !== '' });
  // Ограничения графа берутся у сервера; константы — запасное значение до ответа.
  const config = useResource(configResource, undefined);
  const maxNodes = config.data?.maxNodes ?? MAX_NODES;
  const maxEdges = config.data?.maxEdges ?? MAX_EDGES;
  const canvas = useCanvas(spaceId, maxEdges);
  const [scenario, setScenario] = useState<GenerationData['scenario']>('success');

  // После перезагрузки приложение открывает то же пространство.
  useEffect(() => {
    if (spaceId !== '') rememberSpace(spaceId);
  }, [spaceId]);

  // Незавершённые генерации продолжают отслеживаться после перезагрузки.
  const known = generations.data;
  useEffect(() => {
    if (known !== undefined) resumeGenerations(spaceId, known);
  }, [spaceId, known]);

  // Опрос прекращается при закрытии пространства и уходе со страницы.
  useEffect(() => () => stopWatching(), [spaceId]);

  // Какой генератор сейчас запускается: нода показывает ожидание у себя.
  const [startingId, setStartingId] = useState<string | null>(null);
  const run = useAction(async (nodeId: string) => {
    setStartingId(nodeId);
    try {
      return await startGeneration(spaceId, nodeId, scenario);
    } finally {
      setStartingId(null);
    }
  });
  const { run: startRun } = run;

  /**
   * Производное состояние для нод.
   *
   * Списки API идут от новых к старым, поэтому первое вхождение по ключу —
   * самая свежая попытка. Два индекса строятся одним проходом по списку
   * генераций и обновляются только при его изменении: ноды ничего не ищут при
   * отрисовке, и результат старой попытки не может перекрыть более новую.
   */
  const resultOf = useMemo(
    () => indexByFirst(known ?? EMPTY, (generation) => generation.resultNodeId),
    [known],
  );
  const runningOf = useMemo(() => {
    const running = new Map<string, GenerationData>();
    const list = known ?? EMPTY;
    for (let i = 0; i < list.length; i += 1) {
      const generation = list[i]!;
      // Первая по списку — самая свежая; она и определяет состояние генератора.
      if (!running.has(generation.nodeId)) running.set(generation.nodeId, generation);
    }
    return running;
  }, [known]);

  /** Готовность каждого генератора: один проход по нодам, проверки по индексу. */
  const chainOf = useMemo(() => {
    const chains = new Map<string, Chain>();
    const nodes = canvas.graph.nodes;
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i]!;
      if (node.type === 'generator') chains.set(node.id, inspectChain(canvas.index, node.id));
    }
    return chains;
  }, [canvas.graph.nodes, canvas.index]);

  const api = useMemo<NodeApi>(
    () => ({
      setPromptText: canvas.setPromptText,
      removeNode: canvas.removeNode,
      runGeneration: (nodeId: string) => void startRun(nodeId),
      resultOf,
      runningOf,
      chainOf,
      startingId,
    }),
    [canvas.setPromptText, canvas.removeNode, startRun, resultOf, runningOf, chainOf, startingId],
  );

  const isValidConnection = useCallback<IsValidConnection<CanvasEdge>>(
    (connection) => {
      const { source, target } = connection as Connection;
      return source !== null && target !== null && canvas.canConnect(source, target);
    },
    [canvas],
  );

  /**
   * Новая нода встаёт в колонку своего типа: текст слева, генератор в середине,
   * результат справа. Цепочка собирается слева направо, и ноды не ложатся друг
   * на друга. Смещение считается одним проходом по уже добавленным нодам.
   */
  const addNode = useCallback(
    (kind: NodeKind) => {
      let placed = 0;
      for (let i = 0; i < canvas.nodes.length; i += 1) {
        if (canvas.nodes[i]!.type === kind) placed += 1;
      }
      canvas.addNode(kind, { x: COLUMN[kind], y: 60 + placed * ROW_HEIGHT });
    },
    [canvas],
  );

  const save = describeSave(canvas.document);
  const full = canvas.nodes.length >= maxNodes;

  return (
    <div className={styles.page}>
      <header className={styles.bar}>
        <div className={styles.title}>
          <span className={styles.name}>{space.data?.title ?? 'Пространство'}</span>
          <Link className={styles.back} to="/">
            ← Все пространства
          </Link>
        </div>

        <div className={styles.group}>
          {KINDS.map((kind) => (
            <Button key={kind} variant="secondary" disabled={full} onClick={() => addNode(kind)}>
              + {TITLES[kind]}
            </Button>
          ))}
        </div>

        <div className={styles.group}>
          <label className={styles.groupLabel} htmlFor="scenario">
            Сценарий
          </label>
          <select
            id="scenario"
            className={styles.select}
            value={scenario}
            onChange={(event) => setScenario(event.target.value as GenerationData['scenario'])}
          >
            {SCENARIOS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.title}
              </option>
            ))}
          </select>
        </div>

        {/*
          Текст состояния меняется сразу: индикатор не должен отставать от
          действительности. Плавность даёт переход цвета в CSS, а не подмена
          элемента через анимацию появления.
        */}
        <p className={`${styles.status} ${styles[save.tone]}`} role="status">
          {save.busy ? (
            <span className={ui.spinner} aria-hidden="true" />
          ) : (
            <motion.span
              className={styles.dot}
              aria-hidden="true"
              initial={{ scale: 0.4 }}
              animate={{ scale: 1 }}
              transition={SPRING}
              key={save.tone}
            />
          )}
          {save.text}
        </p>
      </header>

      <div className={styles.notices}>
        <Alert
          show={canvas.document.status === 'conflict'}
          tone="error"
          title="Граф изменился на сервере"
        >
          Ваши правки остались здесь и не отправляются. Перечитайте серверный граф, чтобы продолжить
          — локальные изменения при этом будут заменены.
          <span className={ui.alertActions}>
            <Button variant="secondary" onClick={() => void canvas.reloadFromServer()}>
              Перечитать граф сервера
            </Button>
          </span>
        </Alert>
        <ErrorAlert
          error={canvas.document.status === 'error' ? canvas.document.error : undefined}
          onRetry={canvas.retrySave}
          title="Правки не сохранены"
        />
        <ErrorAlert error={space.error} onRetry={space.reload} title="Пространство не открылось" />
        <ErrorAlert
          error={generations.error}
          onRetry={generations.reload}
          title="Список генераций не загрузился"
        />
        <ErrorAlert error={run.error} title="Генерация не запущена" />
        <Alert
          show={canvas.refusal !== undefined}
          tone="warning"
          title="Связь не создана"
          onRetry={canvas.clearRefusal}
          retryLabel="Понятно"
        >
          {canvas.refusal === undefined ? null : REFUSAL_TEXT[canvas.refusal]}
        </Alert>
        <Alert show={full} tone="warning" title="Достигнут предел">
          Сервер принимает не больше {maxNodes} нод.
        </Alert>
      </div>

      <div className={styles.canvas}>
        <CanvasApiProvider value={api}>
          <ReactFlow<CanvasNode, CanvasEdge>
            nodes={canvas.nodes}
            edges={canvas.edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={canvas.onNodesChange}
            onEdgesChange={canvas.onEdgesChange}
            onConnect={canvas.onConnect}
            onConnectEnd={canvas.onConnectEnd}
            isValidConnection={isValidConnection}
            viewport={canvas.viewport}
            onViewportChange={canvas.onViewportChange}
            nodeExtent={NODE_EXTENT}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            deleteKeyCode={['Delete', 'Backspace']}
            aria-label="Канвас цепочки нод"
          >
            <Background />
            <Controls />
          </ReactFlow>
        </CanvasApiProvider>
      </div>

      <p className={styles.hint}>
        Перетащите связь от правого порта к левому. Текст → генератор → результат. Ноду можно
        удалить крестиком или клавишей Delete.
      </p>
    </div>
  );
}

const EMPTY: readonly GenerationData[] = [];
const KINDS: readonly NodeKind[] = ['prompt', 'generator', 'result'];
/** Колонки под типы нод и шаг по вертикали внутри колонки. */
const COLUMN: Readonly<Record<NodeKind, number>> = { prompt: 60, generator: 400, result: 740 };
const ROW_HEIGHT = 300;
