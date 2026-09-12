import type { ReactNode } from 'react';
import { ErrorAlert } from './Alert';
import styles from './ui.module.css';
import type { UseResource } from '../hooks/useResource';

/**
 * Показ асинхронных данных: загрузка, ошибка и готовое состояние.
 *
 * Одинаковая на всех страницах развилка описана здесь, поэтому экраны не
 * повторяют `if (loading) … if (error) …`. Пока идёт обновление, прежние
 * данные остаются на месте и лишь приглушаются — интерфейс не мигает.
 */
export function AsyncView<T>({
  resource,
  children,
  loadingLabel = 'Загружаем данные…',
  errorTitle,
}: {
  resource: UseResource<T>;
  children: (data: T) => ReactNode;
  loadingLabel?: string;
  errorTitle?: string;
}) {
  if (resource.data === undefined) {
    if (resource.error !== undefined) {
      return <ErrorAlert error={resource.error} onRetry={resource.reload} title={errorTitle} />;
    }
    return (
      <p className={styles.loading} role="status">
        <span className={styles.spinner} aria-hidden="true" />
        {loadingLabel}
      </p>
    );
  }

  return (
    <>
      <ErrorAlert error={resource.error} onRetry={resource.reload} title={errorTitle} />
      <div className={resource.status === 'loading' ? styles.stale : undefined}>
        {children(resource.data)}
      </div>
    </>
  );
}
