import type { FastifyReply, FastifyRequest } from 'fastify';
import { toPublicUser } from '../../../../domain/entities/user.ts';
import { makeRegisterUserUseCase } from '../../../factories/make-register-user-use-case.ts';
import { registerBodySchema } from '../../schemas/auth-schemas.ts';
import { signToken } from './sign-token.ts';

export async function registerController(request: FastifyRequest, reply: FastifyReply) {
  const body = registerBodySchema.parse(request.body);
  const { user } = await makeRegisterUserUseCase().execute(body);
  const token = await signToken(reply, user);
  return reply.status(201).send({ user: toPublicUser(user), token });
}
