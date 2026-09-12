import { expect, test } from '@playwright/test';
import {
  API,
  buildChain,
  node,
  openSpace,
  saved,
  saveStatus,
  serverGenerations,
  serverGraph,
} from './canvas';

test('конфликт версий сохраняет черновик и даёт перечитать граф сервера', async ({ page }) => {
  const spaceId = await openSpace(page, 'Конфликт');
  await buildChain(page, 'Исходный текст');
  await saved(page);

  // Кто-то другой изменил граф: версия у клиента стала неактуальной.
  const { etag, graph } = await serverGraph(page, spaceId);
  const outside = await page.request.put(`${API}/api/spaces/${spaceId}/graph`, {
    headers: { 'If-Match': etag, 'Content-Type': 'application/json' },
    data: { ...graph, viewport: { x: 25, y: 25, zoom: 1 } },
  });
  expect(outside.ok()).toBeTruthy();

  await page.getByLabel('Описание изображения').fill('Мой черновик');
  await expect(page.getByText('Граф изменился на сервере')).toBeVisible();
  await expect(saveStatus(page)).toHaveText(/Версии разошлись/);
  // Черновик остаётся на экране и не теряется.
  await expect(page.getByLabel('Описание изображения')).toHaveValue('Мой черновик');

  // Генерация при неудачном сохранении не запускается.
  await page.getByRole('button', { name: 'Сгенерировать' }).click();
  await expect(page.getByText('Генерация не запущена')).toBeVisible();
  expect(await serverGenerations(page, spaceId)).toHaveLength(0);

  await page.getByRole('button', { name: 'Перечитать граф сервера' }).click();
  await expect(page.getByLabel('Описание изображения')).toHaveValue('Исходный текст');
  await expect(page.getByText('Граф изменился на сервере')).toHaveCount(0);

  // После перечитывания работа продолжается обычным порядком.
  await page.getByLabel('Описание изображения').fill('После конфликта');
  await saved(page);
});

test('тестовый отказ показывается и допускает новый запуск', async ({ page }) => {
  const spaceId = await openSpace(page, 'Отказ');
  await buildChain(page, 'Пустыня');
  await saved(page);

  await page.getByLabel('Сценарий').selectOption('failure');
  await page.getByRole('button', { name: 'Сгенерировать' }).click();
  await expect(page.getByText('Генерация не удалась. Попробуйте ещё раз.')).toBeVisible({
    timeout: 30_000,
  });
  await expect(node(page, 'result')).toContainText('Генерация не удалась');

  // Повтор с другим сценарием — это новый запуск с новым ключом.
  await page.getByLabel('Сценарий').selectOption('success');
  await page.getByRole('button', { name: 'Повторить генерацию' }).click();
  await expect(node(page, 'result').locator('img')).toBeVisible({ timeout: 30_000 });

  const generations = await serverGenerations(page, spaceId);
  expect(generations).toHaveLength(2);
  expect(generations[0]!.status).toBe('succeeded');
});

test('двойное нажатие не создаёт вторую генерацию', async ({ page }) => {
  const spaceId = await openSpace(page, 'Двойное нажатие');
  await buildChain(page, 'Река');
  await saved(page);

  const button = page.getByRole('button', { name: 'Сгенерировать' });
  await button.click({ clickCount: 2, delay: 10 });
  await expect(node(page, 'result').locator('img')).toBeVisible({ timeout: 30_000 });

  expect(await serverGenerations(page, spaceId)).toHaveLength(1);
});

test('перезагрузка восстанавливает граф, результат и незавершённую генерацию', async ({ page }) => {
  const spaceId = await openSpace(page, 'Перезагрузка');
  await buildChain(page, 'Озеро в тумане');
  await saved(page);

  await page.getByRole('button', { name: 'Сгенерировать' }).click();
  await expect(node(page, 'result').getByRole('status')).toHaveText(/Генерация идёт/);

  // Уходим со страницы, пока генерация не завершилась.
  await page.reload();

  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await expect(page.getByLabel('Описание изображения')).toHaveValue('Озеро в тумане');
  // Незавершённая генерация дочитывается до результата.
  await expect(node(page, 'result').locator('img')).toBeVisible({ timeout: 30_000 });

  expect(await serverGenerations(page, spaceId)).toHaveLength(1);

  // Результат переживает ещё одну перезагрузку.
  await page.reload();
  await expect(node(page, 'result').locator('img')).toBeVisible();
});

test('результат не подставляется в ноду удалённой цепочки', async ({ page }) => {
  await openSpace(page, 'Удалённая цепочка');
  await buildChain(page, 'Город ночью');
  await saved(page);

  await page.getByRole('button', { name: 'Сгенерировать' }).click();
  await expect(node(page, 'result').getByRole('status')).toHaveText(/Генерация идёт/);

  // Нода результата исчезает до завершения генерации.
  await node(page, 'result')
    .getByRole('button', { name: /Удалить ноду/ })
    .click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);

  // Новая нода результата не получает чужой результат.
  await page.getByRole('button', { name: '+ Результат' }).click();
  await page.waitForTimeout(4000);
  await expect(node(page, 'result').locator('img')).toHaveCount(0);
  await expect(node(page, 'result')).toContainText('Здесь появится изображение');
});

test('сбой сети при сохранении не теряет правки и допускает повтор', async ({ page }) => {
  const spaceId = await openSpace(page, 'Сбой сети');
  await buildChain(page, 'Начальный текст');
  await saved(page);

  await page.route('**/graph', (route) =>
    route.request().method() === 'PUT' ? route.abort('failed') : route.continue(),
  );
  await page.getByLabel('Описание изображения').fill('Текст во время сбоя');
  await expect(page.getByText('Правки не сохранены')).toBeVisible();
  await expect(page.getByLabel('Описание изображения')).toHaveValue('Текст во время сбоя');

  await page.unroute('**/graph');
  await page.getByRole('button', { name: 'Повторить' }).click();
  await saved(page);

  const { graph } = await serverGraph(page, spaceId);
  const prompt = graph.nodes.find((item) => item.type === 'prompt') as
    { data: { text: string } } | undefined;
  expect(prompt?.data.text).toBe('Текст во время сбоя');
});
