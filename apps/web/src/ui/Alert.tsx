import { useRef, type ReactNode } from 'react';
import { Button } from './Button';
import { AnimatePresence, motion, rise, useMotionEnabled } from './motion';
import styles from './ui.module.css';
import type { AppError } from '../api/errors';

export type AlertTone = 'error' | 'info' | 'success' | 'warning';

const TONE_CLASS: Readonly<Record<AlertTone, string>> = {
  error: styles.toneError!,
  info: styles.toneInfo!,
  success: styles.toneSuccess!,
  warning: styles.toneWarning!,
};

export type AlertProps = {
  tone?: AlertTone;
  title?: string;
  children?: ReactNode;
  /** Кнопка повтора: появляется только там, где повтор осмыслен. */
  onRetry?: (() => void) | undefined;
  retryLabel?: string;
  requestId?: string | undefined;
  /**
   * Показывать ли сообщение. Условие живёт внутри компонента, поэтому места
   * использования не повторяют одинаковый тернарник, а появление и уход
   * анимируются одинаково во всём приложении.
   */
  show?: boolean;
};

export function Alert({
  tone = 'info',
  title,
  children,
  onRetry,
  retryLabel = 'Повторить',
  requestId,
  show = true,
}: AlertProps) {
  const enabled = useMotionEnabled();
  return (
    <AnimatePresence initial={false}>
      {show ? (
        <motion.div
          className={`${styles.alert} ${TONE_CLASS[tone]}`}
          role={tone === 'error' ? 'alert' : 'status'}
          variants={enabled ? rise : undefined}
          initial="hidden"
          animate="shown"
          exit="gone"
        >
          {title !== undefined ? <strong>{title}</strong> : null}
          {children !== undefined && children !== null ? <div>{children}</div> : null}
          {requestId !== undefined ? (
            <span className={styles.requestId}>Код обращения: {requestId}</span>
          ) : null}
          {onRetry !== undefined ? (
            <div className={styles.alertActions}>
              <Button variant="secondary" onClick={onRetry}>
                {retryLabel}
              </Button>
            </div>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * Показ разобранной ошибки API.
 *
 * Компонент получает `AppError` или его отсутствие и сам решает, показываться
 * ли: это убирает одинаковую проверку из каждого места вызова. Разбирать
 * ответ, выбирать текст и определять, можно ли повторить, здесь уже не нужно —
 * это сделано в слое запросов.
 */
export function ErrorAlert({
  error,
  onRetry,
  title,
}: {
  error: AppError | null | undefined;
  onRetry?: (() => void) | undefined;
  title?: string;
}) {
  // На прощальном кадре ошибки уже нет, а текст показать надо: держим последнюю.
  const last = useRef<AppError | null>(null);
  const present = error !== null && error !== undefined;
  if (present) last.current = error;
  const shown = present ? error : last.current;

  return (
    <Alert
      show={present}
      tone="error"
      title={title ?? 'Не удалось выполнить действие'}
      onRetry={shown?.retryable === true ? onRetry : undefined}
      requestId={shown?.requestId}
    >
      {shown?.message}
    </Alert>
  );
}
