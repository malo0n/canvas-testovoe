import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './ui.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & {
  variant?: ButtonVariant;
  /** Действие выполняется: кнопка блокируется и сообщает об ожидании. */
  pending?: boolean;
  block?: boolean;
  children: ReactNode;
};

/**
 * Кнопка приложения. Состояние ожидания, блокировка на время запроса и
 * сообщение для скринридера описаны здесь один раз: страницам не нужно
 * повторять `disabled={pending}` и подстановку спиннера.
 *
 * Спиннер не встраивается в поток, а накладывается поверх приглушённой
 * подписи. Иначе ширина кнопки менялась бы на время запроса и соседние
 * элементы подпрыгивали бы при каждом нажатии. Подпись при этом остаётся в
 * дереве доступности, поэтому кнопка не теряет имя во время ожидания.
 */
export function Button({
  variant = 'secondary',
  pending = false,
  block = false,
  disabled,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled === true || pending}
      aria-busy={pending || undefined}
      className={`${styles.button} ${styles[variant]}${block ? ` ${styles.block}` : ''}`}
    >
      <span className={pending ? styles.labelBusy : undefined}>{children}</span>
      {pending ? (
        <span className={styles.busy} aria-hidden="true">
          <span className={styles.spinner} />
        </span>
      ) : null}
    </button>
  );
}
