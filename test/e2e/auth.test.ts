import jwt from '@fastify/jwt';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { requireRole } from '../../src/infra/http/middlewares/require-role.ts';
import { prisma } from '../../src/infra/repositories/prisma/prisma-client.ts';
import { registerUser, uniqueEmail } from './helpers.ts';

describe('auth (RF-01, RF-02)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    // Rota só de teste, para provar o requireRole sem depender de features futuras.
    app.get('/test/auctioneer-only', { preHandler: requireRole('AUCTIONEER') }, async () => ({
      ok: true,
    }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('POST /auth/register cria a conta e devolve user + token, sem o hash', async () => {
    const { payload, response } = await registerUser(app, { role: 'AUCTIONEER' });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.token).toEqual(expect.any(String));
    expect(body.user).toEqual({
      id: expect.any(String),
      name: payload.name,
      email: payload.email,
      role: 'AUCTIONEER',
    });
    expect(response.body).not.toContain('passwordHash');
    expect(response.body).not.toContain(payload.password);
  });

  it('guarda a senha com hash bcrypt, nunca em texto puro', async () => {
    const { payload } = await registerUser(app);
    const stored = await prisma.user.findUniqueOrThrow({ where: { email: payload.email } });
    expect(stored.passwordHash).not.toBe(payload.password);
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
  });

  it('e-mail repetido → 409 EMAIL_TAKEN', async () => {
    const email = uniqueEmail('dup');
    await registerUser(app, { email });
    const { response } = await registerUser(app, { email: email.toUpperCase() });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: { code: 'EMAIL_TAKEN', message: expect.any(String) },
    });
  });

  it('body inválido → 400 VALIDATION_ERROR (senha curta, papel inválido)', async () => {
    const short = await registerUser(app, { password: '1234567' });
    expect(short.response.statusCode).toBe(400);
    expect(short.response.json().error.code).toBe('VALIDATION_ERROR');

    const badRole = await registerUser(app, { role: 'ADMIN' });
    expect(badRole.response.statusCode).toBe(400);
    expect(badRole.response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /auth/login com credenciais certas → 200 user + token', async () => {
    const { payload } = await registerUser(app);
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: payload.email, password: payload.password },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.token).toEqual(expect.any(String));
    expect(body.user.email).toBe(payload.email);
    expect(body.user).not.toHaveProperty('passwordHash');
  });

  it('login com senha errada ou e-mail inexistente → 401 INVALID_CREDENTIALS', async () => {
    const { payload } = await registerUser(app);

    for (const credentials of [
      { email: payload.email, password: 'senha-errada-999' },
      { email: uniqueEmail('ghost'), password: payload.password },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: credentials,
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        error: { code: 'INVALID_CREDENTIALS', message: expect.any(String) },
      });
    }
  });

  it('GET /auth/me com token → 200 { user }', async () => {
    const { payload, response } = await registerUser(app);
    const { token } = response.json();

    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({
      user: { id: expect.any(String), name: payload.name, email: payload.email, role: 'BIDDER' },
    });
    expect(me.body).not.toContain('passwordHash');
  });

  it('GET /auth/me sem token ou com token inválido → 401 UNAUTHORIZED', async () => {
    for (const headers of [{}, { authorization: 'Bearer token-invalido' }]) {
      const response = await app.inject({ method: 'GET', url: '/auth/me', headers });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        error: { code: 'UNAUTHORIZED', message: expect.any(String) },
      });
    }
  });

  it('token assinado com outro segredo → 401', async () => {
    const forger = Fastify();
    await forger.register(jwt, { secret: 'outro-segredo-com-pelo-menos-32-caracteres' });
    await forger.ready();
    const { user } = (await registerUser(app)).response.json();
    const forged = forger.jwt.sign({ sub: user.id, role: 'AUCTIONEER' });
    await forger.close();

    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${forged}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it('requireRole: sem login → 401, papel errado → 403 FORBIDDEN, papel certo → 200', async () => {
    const anonymous = await app.inject({ method: 'GET', url: '/test/auctioneer-only' });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().error.code).toBe('UNAUTHORIZED');

    const bidder = (await registerUser(app, { role: 'BIDDER' })).response.json();
    const forbidden = await app.inject({
      method: 'GET',
      url: '/test/auctioneer-only',
      headers: { authorization: `Bearer ${bidder.token}` },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toEqual({
      error: { code: 'FORBIDDEN', message: expect.any(String) },
    });

    const auctioneer = (await registerUser(app, { role: 'AUCTIONEER' })).response.json();
    const allowed = await app.inject({
      method: 'GET',
      url: '/test/auctioneer-only',
      headers: { authorization: `Bearer ${auctioneer.token}` },
    });
    expect(allowed.statusCode).toBe(200);
  });
});
