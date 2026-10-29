import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';

describe('GET /health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde ok quando o banco está de pé', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('rota inexistente devolve o formato de erro padrão', async () => {
    const response = await app.inject({ method: 'GET', url: '/nao-existe' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: expect.any(String) },
    });
  });

  it('CORS libera só a origem configurada', async () => {
    const allowed = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');

    const blocked = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://malicioso.example' },
    });
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });
});
