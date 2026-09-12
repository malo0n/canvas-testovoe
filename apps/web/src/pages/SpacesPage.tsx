import { useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { call } from '../api/client';
import { api } from '../api/endpoints';
import { useAction } from '../hooks/useAction';
import { useResource } from '../hooks/useResource';
import { spacesResource } from '../store/resources';
import { lastSpace, rememberSpace } from '../store/lastSpace';
import { AsyncView, Button, ErrorAlert, TextField } from '../ui';
import ui from '../ui/ui.module.css';
import styles from './spaces.module.css';

/** Ограничение совпадает со схемой API: непустая строка до 80 символов. */
const TITLE_MAX = 80;

const titleError = (value: string): string | undefined => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'Введите название';
  if (trimmed.length > TITLE_MAX) return `Не длиннее ${TITLE_MAX} символов`;
  return undefined;
};

export function SpacesPage() {
  const spaces = useResource(spacesResource, undefined);
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [touched, setTouched] = useState(false);
  const fieldId = useId();

  const error = titleError(title);
  const create = useAction(
    async (value: string) => {
      const { data } = await call(api.createSpace, { title: value.trim() });
      return data;
    },
    {
      onSuccess: (space) => {
        setTitle('');
        setTouched(false);
        rememberSpace(space.id);
        void spacesResource.load(undefined, { force: true });
        void navigate(`/spaces/${space.id}`);
      },
    },
  );

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1>Рабочие пространства</h1>
        <p className={styles.subtitle}>
          В пространстве собирается цепочка «текст → генератор → результат». Граф сохраняется
          автоматически, генерация изображения тестовая.
        </p>
      </header>

      <form
        className={`${ui.card} ${styles.create}`}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (error === undefined) void create.run(title);
          else document.getElementById(fieldId)?.focus();
        }}
      >
        <div className={styles.createField}>
          <TextField
            label="Название пространства"
            maxLength={TITLE_MAX}
            field={{
              id: fieldId,
              name: 'title',
              value: title,
              error: touched ? error : undefined,
              onChange: setTitle,
              onBlur: () => setTouched(true),
            }}
          />
        </div>
        <Button type="submit" variant="primary" pending={create.pending}>
          Создать
        </Button>
      </form>

      {create.error !== null ? (
        <ErrorAlert error={create.error} title="Пространство не создано" />
      ) : null}

      <AsyncView resource={spaces} loadingLabel="Загружаем пространства…">
        {(list) =>
          list.length === 0 ? (
            <p className={`${ui.card} ${styles.empty}`}>
              Пространств пока нет. Создайте первое — оно откроется сразу.
            </p>
          ) : (
            <ul className={ui.card}>
              {list.map((space) => (
                <li className={styles.item} key={space.id}>
                  <Link className={styles.itemTitle} to={`/spaces/${space.id}`}>
                    {space.title}
                  </Link>
                  <span className={styles.itemMeta}>{formatDate(space.createdAt)}</span>
                </li>
              ))}
            </ul>
          )
        }
      </AsyncView>

      <ResumeLastSpace />
    </div>
  );
}

/** Подсказка вернуться в последнее открытое пространство после перезагрузки. */
function ResumeLastSpace() {
  const [spaceId, setSpaceId] = useState<string | null>(null);
  useEffect(() => setSpaceId(lastSpace()), []);
  if (spaceId === null) return null;
  return (
    <p>
      <Link to={`/spaces/${spaceId}`}>Открыть последнее пространство</Link>
    </p>
  );
}

const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

const formatDate = (iso: string): string => {
  const value = Date.parse(iso);
  return Number.isNaN(value) ? '' : dateFormat.format(value);
};
