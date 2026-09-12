import { expect, type Page, type Locator } from '@playwright/test';

/**
 * Шаги работы с канвасом, общие для проверок. Держим их отдельно, чтобы тесты
 * описывали поведение, а не повторяли одни и те же клики.
 */
export const API = 'http://localhost:4001';

export const node = (page: Page, kind: 'prompt' | 'generator' | 'result') =>
  page.locator(`.react-flow__node-${kind}`);

export const saveStatus = (page: Page) => page.getByRole('status').first();

/** Создаёт пространство и открывает его канвас. */
export async function openSpace(page: Page, title: string): Promise<string> {
  await page.goto('/');
  await page.getByLabel('Название пространства').fill(title);
  await page.getByRole('button', { name: 'Создать' }).click();
  await page.waitForURL(/\/spaces\/[0-9a-f-]{36}$/);
  return page.url().split('/').at(-1)!;
}

export async function addChainNodes(page: Page): Promise<void> {
  await page.getByRole('button', { name: '+ Текст' }).click();
  await page.getByRole('button', { name: '+ Генератор' }).click();
  await page.getByRole('button', { name: '+ Результат' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
}

/** Перетаскивает связь от правого порта одной ноды к левому порту другой. */
export async function connect(page: Page, from: Locator, to: Locator): Promise<void> {
  const source = from.locator('.react-flow__handle-right');
  const target = to.locator('.react-flow__handle-left');
  const a = (await source.boundingBox())!;
  const b = (await target.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

export async function buildChain(page: Page, text: string): Promise<void> {
  await addChainNodes(page);
  await page.getByLabel('Описание изображения').fill(text);
  await connect(page, node(page, 'prompt'), node(page, 'generator'));
  await connect(page, node(page, 'generator'), node(page, 'result'));
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
}

/**
 * Ждёт, что правки действительно дошли до сервера: сначала индикатор
 * показывает несохранённое состояние, затем сохранённое. Без первой проверки
 * ожидание могло бы совпасть с прежним состоянием и пройти слишком рано.
 */
export async function saved(page: Page): Promise<void> {
  await expect(saveStatus(page)).toHaveText(/Есть несохранённые правки|Сохраняем/);
  await expect(saveStatus(page)).toHaveText(/Все правки сохранены/);
}

/** Граф пространства напрямую из API: проверка того, что реально сохранено. */
export async function serverGraph(page: Page, spaceId: string) {
  const response = await page.request.get(`${API}/api/spaces/${spaceId}/graph`);
  expect(response.ok()).toBeTruthy();
  return {
    etag: response.headers()['etag']!,
    graph: (await response.json()) as {
      nodes: { id: string; type: string }[];
      edges: { id: string; source: string; target: string }[];
      viewport: { x: number; y: number; zoom: number };
    },
  };
}

export async function serverGenerations(page: Page, spaceId: string) {
  const response = await page.request.get(`${API}/api/spaces/${spaceId}/generations`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as { id: string; status: string; nodeId: string }[];
}
