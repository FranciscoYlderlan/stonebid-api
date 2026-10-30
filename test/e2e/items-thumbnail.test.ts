import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { THUMBNAIL_RATE_LIMIT } from '../../src/infra/http/routes/items-routes.ts';
import {
  IMG_900001,
  IMG_900003,
  IMG_BIG,
  MOCK_IMAGE,
  startItemsApiMock,
  type ItemsApiMock,
} from './items-api-mock.ts';

const thumbnailUrl = (imageId: string) => `/items/images/${imageId}/thumbnail`;
const iiifCalls = (mock: ItemsApiMock) =>
  mock.requests.filter((request) => request.url.startsWith('/iiif/2/'));

describe('GET /items/images/:imageId/thumbnail: cache e limite (RF-20, T5g)', () => {
  let app: FastifyInstance;
  let mock: ItemsApiMock;

  beforeAll(async () => {
    mock = await startItemsApiMock(300);
    app = await buildApp({ itemCatalog: mock.catalog });
    await app.ready();
  });

  beforeEach(() => {
    mock.setMode('ok');
    mock.requests.length = 0;
  });

  afterAll(async () => {
    await app.close();
    await mock.close();
  });

  it('o mesmo id sai do cache na segunda vez, sem nova ida à AIC (maiúsculas incluídas)', async () => {
    const first = await app.inject({ method: 'GET', url: thumbnailUrl(IMG_900001) });
    const second = await app.inject({ method: 'GET', url: thumbnailUrl(IMG_900001) });
    const upper = await app.inject({ method: 'GET', url: thumbnailUrl(IMG_900001.toUpperCase()) });

    for (const response of [first, second, upper]) {
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('image/png');
      expect(response.headers['cache-control']).toBe('public, max-age=604800, immutable');
      expect(Buffer.compare(response.rawPayload, MOCK_IMAGE)).toBe(0);
    }
    expect(iiifCalls(mock)).toHaveLength(1);
  });

  it('pedidos simultâneos do mesmo id fazem uma só busca na AIC', async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => app.inject({ method: 'GET', url: thumbnailUrl(IMG_900003) })),
    );
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200, 200, 200]);
    expect(iiifCalls(mock)).toHaveLength(1);
  });

  it('pedidos simultâneos com a AIC fora do ar: uma busca, todos 502, nada no cache', async () => {
    mock.setMode('down');
    const responses = await Promise.all(
      Array.from({ length: 3 }, () => app.inject({ method: 'GET', url: thumbnailUrl(IMG_BIG) })),
    );
    expect(responses.map((response) => response.statusCode)).toEqual([502, 502, 502]);
    expect(iiifCalls(mock)).toHaveLength(1);

    mock.setMode('ok');
    const retry = await app.inject({ method: 'GET', url: thumbnailUrl(IMG_BIG) });
    expect(retry.statusCode).toBe(200);
    expect(iiifCalls(mock)).toHaveLength(2);
  });

  it('acima do limite por IP → 429 TOO_MANY_REQUESTS só nessa rota', async () => {
    const otherIp = '203.0.113.7';
    // Id inválido: conta no limite (o limite roda antes da validação) sem ir à AIC.
    const invalid = { method: 'GET' as const, url: thumbnailUrl('x'), remoteAddress: otherIp };
    for (let i = 0; i < THUMBNAIL_RATE_LIMIT.max; i += 1) {
      const response = await app.inject(invalid);
      expect(response.statusCode).toBe(400);
    }

    const limited = await app.inject({ ...invalid, url: thumbnailUrl(IMG_900001) });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({
      error: { code: 'TOO_MANY_REQUESTS', message: expect.stringContaining('Muitas requisições') },
    });
    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.headers['cache-control']).toBeUndefined();

    // Outras rotas, mesmo IP: sem limite.
    const health = await app.inject({ method: 'GET', url: '/health', remoteAddress: otherIp });
    expect(health.statusCode).not.toBe(429);
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {},
      remoteAddress: otherIp,
    });
    expect(login.statusCode).toBe(400);

    // Outro IP segue livre na mesma rota.
    const otherClient = await app.inject({ method: 'GET', url: thumbnailUrl(IMG_900001) });
    expect(otherClient.statusCode).toBe(200);
  });
});
