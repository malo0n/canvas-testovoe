import { expect, test } from '@playwright/test';
import {
  buildChain,
  connect,
  node,
  openSpace,
  saved,
  serverGenerations,
  serverGraph,
} from './canvas';

test('основной сценарий: цепочка, сохранение и генерация изображения', async ({ page }) => {
  const spaceId = await openSpace(page, 'Основной сценарий');
  await buildChain(page, 'Горы на рассвете');
  await saved(page);

  // Сервер принял ноды, связи и положение канваса.
  const { graph } = await serverGraph(page, spaceId);
  expect(graph.nodes.map((item) => item.type).sort()).toEqual(['generator', 'prompt', 'result']);
  expect(graph.edges).toHaveLength(2);
  expect(graph.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
  // Служебные поля React Flow в запрос не попадают.
  expect(Object.keys(graph.nodes[0]!).sort()).toEqual(['data', 'id', 'position', 'type']);

  await page.getByRole('button', { name: 'Сгенерировать' }).click();
  await expect(node(page, 'result').getByRole('status')).toHaveText(/Генерация идёт/);

  const image = node(page, 'result').locator('img');
  await expect(image).toBeVisible({ timeout: 30_000 });
  await expect(image).toHaveAttribute('src', /\/assets\/demo\.svg$/);

  const generations = await serverGenerations(page, spaceId);
  expect(generations).toHaveLength(1);
  expect(generations[0]!.status).toBe('succeeded');
});

test('быстрые правки дают одно сохранение после паузы', async ({ page }) => {
  const puts: number[] = [];
  page.on('response', (response) => {
    if (response.request().method() === 'PUT' && response.url().includes('/graph')) {
      puts.push(response.status());
    }
  });

  await openSpace(page, 'Debounce');
  await page.getByRole('button', { name: '+ Текст' }).click();
  await page.getByLabel('Описание изображения').pressSequentially('Море и скалы', { delay: 30 });

  // Пока идёт серия правок, запросов нет.
  expect(puts).toHaveLength(0);
  await saved(page);
  expect(puts).toEqual([200]);

  // Одиночная правка тоже сохраняется.
  await page.getByRole('button', { name: '+ Результат' }).click();
  await saved(page);
  expect(puts).toEqual([200, 200]);
});

test('запуск сразу после правки дожидается сохранения графа', async ({ page }) => {
  const order: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (request.method() === 'PUT' && url.includes('/graph')) order.push('PUT graph');
    if (request.method() === 'POST' && url.includes('/generations')) order.push('POST generation');
  });

  const spaceId = await openSpace(page, 'Досохранение');
  await buildChain(page, 'Первый текст');
  await saved(page);

  // Правка и немедленный запуск: таймер debounce ещё не сработал.
  await page.getByLabel('Описание изображения').fill('Изменённый текст');
  await page.getByRole('button', { name: 'Сгенерировать' }).click();

  await expect(node(page, 'result').locator('img')).toBeVisible({ timeout: 30_000 });
  expect(order.at(-2)).toBe('PUT graph');
  expect(order.at(-1)).toBe('POST generation');

  // Сервер запомнил именно последний текст.
  const { graph } = await serverGraph(page, spaceId);
  const prompt = graph.nodes.find((item) => item.type === 'prompt') as
    { data: { text: string } } | undefined;
  expect(prompt?.data.text).toBe('Изменённый текст');
});

test('несовместимые связи и лишние входы не создаются', async ({ page }) => {
  await openSpace(page, 'Связи');
  await page.getByRole('button', { name: '+ Текст' }).click();
  await page.getByRole('button', { name: '+ Текст' }).click();
  await page.getByRole('button', { name: '+ Генератор' }).click();
  await page.getByRole('button', { name: '+ Результат' }).click();

  const prompts = node(page, 'prompt');

  // Текст напрямую в результат — запрещено.
  await connect(page, prompts.first(), node(page, 'result'));
  await expect(page.getByText(/Допустимы только связи/)).toBeVisible();
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await page.getByRole('button', { name: 'Понятно' }).click();

  // Первый вход занимается, второй текст в тот же генератор уже нельзя.
  await connect(page, prompts.first(), node(page, 'generator'));
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await connect(page, prompts.nth(1), node(page, 'generator'));
  await expect(page.getByText(/У входа уже есть связь/)).toBeVisible();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
});

test('удаление ноды уносит её связи, сервер принимает остаток', async ({ page }) => {
  const spaceId = await openSpace(page, 'Удаление');
  await buildChain(page, 'Лес');
  await saved(page);

  await node(page, 'generator')
    .getByRole('button', { name: /Удалить ноду/ })
    .click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await saved(page);

  const { graph } = await serverGraph(page, spaceId);
  expect(graph.nodes).toHaveLength(2);
  expect(graph.edges).toHaveLength(0);
});
