import '@fastify/jwt';
import type { Role } from '../domain/entities/user.ts';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; role: Role };
    user: { sub: string; role: Role };
  }
}
