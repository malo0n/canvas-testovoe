import { memo, type ReactNode } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { apiUrl } from '../../api/transport';
import { Button } from '../../ui';
import { AnimatePresence, EASE, motion, pop, useMotionEnabled } from '../../ui/motion';
import ui from '../../ui/ui.module.css';
import styles from './canvas.module.css';
import { useNodeApi } from './context';
import { CHAIN_TEXT, TITLES } from './rules';
import type { NodeKind } from './rules';
import type { GeneratorNode, PromptNode, ResultNode } from './model';

const PROMPT_MAX = 2000;

/**
 * Оболочка ноды: общий вид, появление и выделение. Все три типа пользуются ею,
 * поэтому поведение задано один раз.
 */
function NodeShell({ children }: { children: ReactNode }) {
  const enabled = useMotionEnabled();
  return (
    <motion.div
      className={styles.node}
      variants={enabled ? pop : undefined}
      initial="hidden"
      animate="shown"
    >
      {children}
    </motion.div>
  );
}

/** Шапка ноды: тип и удаление. Одинакова у всех трёх типов. */
function NodeHead({ id, kind }: { id: string; kind: NodeKind }) {
  const { removeNode } = useNodeApi();
  return (
    <div className={styles.head}>
      <span className={styles.kind}>{TITLES[kind]}</span>
      <Button
        variant="ghost"
        onClick={() => removeNode(id)}
        aria-label={`Удалить ноду: ${TITLES[kind]}`}
      >
        ✕
      </Button>
    </div>
  );
}

/**
 * Ноды канваса.
 *
 * Каждая получает готовое состояние из контекста и отвечает только за показ.
 * `memo` вместе с сохранением ссылок при изменении одной ноды оставляет
 * перерисовку той ноды, которую действительно поменяли.
 */
const PromptNodeView = memo(function PromptNodeView({ id, data }: NodeProps<PromptNode>) {
  const { setPromptText } = useNodeApi();
  const fieldId = `prompt-${id}`;
  return (
    <NodeShell>
      <NodeHead id={id} kind="prompt" />
      <label className={ui.label} htmlFor={fieldId}>
        Описание изображения
      </label>
      <textarea
        id={fieldId}
        className={`${styles.textarea} nodrag nowheel`}
        value={data.text}
        maxLength={PROMPT_MAX}
        placeholder="Например: горы на рассвете"
        onChange={(event) => setPromptText(id, event.target.value)}
      />
      <span className={styles.counter}>
        {data.text.length} / {PROMPT_MAX}
      </span>
      <Handle type="source" position={Position.Right} className={styles.port} />
    </NodeShell>
  );
});

const GeneratorNodeView = memo(function GeneratorNodeView({ id, data }: NodeProps<GeneratorNode>) {
  const { runGeneration, chainOf, runningOf, startingId } = useNodeApi();
  const chain = chainOf.get(id);
  const running = runningOf.get(id);
  const failed = running?.status === 'failed';
  const busy = running?.status === 'processing' || startingId === id;

  return (
    <NodeShell>
      <NodeHead id={id} kind="generator" />
      <strong>{data.label}</strong>

      {chain?.problem !== undefined ? (
        <p className={styles.problem}>{CHAIN_TEXT[chain.problem]}</p>
      ) : null}
      {failed ? <p className={styles.failure}>Генерация не удалась. Попробуйте ещё раз.</p> : null}

      <Button
        variant="primary"
        block
        pending={busy}
        disabled={chain?.problem !== undefined}
        onClick={() => runGeneration(id)}
      >
        {failed ? 'Повторить генерацию' : 'Сгенерировать'}
      </Button>

      <Handle type="target" position={Position.Left} className={styles.port} />
      <Handle type="source" position={Position.Right} className={styles.port} />
    </NodeShell>
  );
});

const ResultNodeView = memo(function ResultNodeView({ id, data }: NodeProps<ResultNode>) {
  const { resultOf } = useNodeApi();
  const generation = resultOf.get(id);
  const enabled = useMotionEnabled();

  return (
    <NodeShell>
      <NodeHead id={id} kind="result" />
      <strong>{data.label}</strong>

      {/* Ключ по состоянию: смена вида проявляется, а не подменяется рывком. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={generation?.status ?? 'empty'}
          initial={enabled ? { opacity: 0 } : false}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={EASE}
        >
          {generation?.status === 'succeeded' && generation.imageUrl !== null ? (
            <img
              className={styles.preview}
              src={apiUrl(generation.imageUrl)}
              alt={`Результат по описанию: ${generation.prompt}`}
            />
          ) : generation?.status === 'processing' ? (
            <p className={`${styles.placeholder} ${styles.waiting}`} role="status">
              <span className={ui.spinner} aria-hidden="true" />
              Генерация идёт…
            </p>
          ) : generation?.status === 'failed' ? (
            <p className={styles.placeholder}>Генерация не удалась</p>
          ) : (
            <p className={styles.placeholder}>Здесь появится изображение</p>
          )}
        </motion.div>
      </AnimatePresence>

      <Handle type="target" position={Position.Left} className={styles.port} />
    </NodeShell>
  );
});

export const NODE_TYPES = {
  prompt: PromptNodeView,
  generator: GeneratorNodeView,
  result: ResultNodeView,
};
