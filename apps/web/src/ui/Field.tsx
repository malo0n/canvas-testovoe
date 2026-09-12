import type { InputHTMLAttributes, ReactNode } from 'react';
import styles from './ui.module.css';

/** Связка поля с его состоянием: значение, ошибка и обработчики ввода. */
export type FieldProps = {
  id: string;
  name: string;
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
  onBlur?: () => void;
};

/** Сообщение об ошибке поля: одна разметка и одна связь через `aria-describedby`. */
export function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (message === undefined) return null;
  return (
    <span className={styles.error} id={id}>
      {message}
    </span>
  );
}

type Shared = {
  label: string;
  hint?: string;
  optional?: boolean;
};

/**
 * Обвязка поля формы: подпись, подсказка, сообщение об ошибке и связи
 * `aria-describedby` / `aria-invalid`.
 *
 * Это единственное место, где описано, как поле выглядит и как о нём узнаёт
 * скринридер. Конкретные поля добавляют только свой элемент ввода.
 */
export function Field({
  label,
  hint,
  optional = false,
  id,
  error,
  children,
}: Shared & {
  id: string;
  error: string | undefined;
  children: (aria: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}) {
  const hintId = hint === undefined ? undefined : `${id}-hint`;
  const errorId = error === undefined ? undefined : `${id}-error`;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {optional ? <span className={styles.optional}> — необязательно</span> : null}
      </label>
      {children({ id, describedBy, invalid: error !== undefined })}
      <FieldError id={`${id}-error`} message={error} />
      {hint !== undefined ? (
        <span className={styles.hint} id={hintId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export type TextFieldProps = Shared & {
  field: FieldProps;
  type?: InputHTMLAttributes<HTMLInputElement>['type'];
  autoComplete?: string;
  inputMode?: InputHTMLAttributes<HTMLInputElement>['inputMode'];
  placeholder?: string;
  maxLength?: number;
};

/** Текстовое поле: подпись, ошибка и связи доступности приходят из `Field`. */
export function TextField({
  field,
  type = 'text',
  autoComplete,
  inputMode,
  placeholder,
  maxLength,
  ...shared
}: TextFieldProps) {
  return (
    <Field {...shared} id={field.id} error={field.error}>
      {({ id, describedBy, invalid }) => (
        <input
          className={styles.control}
          id={id}
          name={field.name}
          type={type}
          value={field.value}
          autoComplete={autoComplete}
          inputMode={inputMode}
          placeholder={placeholder}
          maxLength={maxLength}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(event) => field.onChange(event.target.value)}
          onBlur={field.onBlur}
        />
      )}
    </Field>
  );
}
