import type { FastifyReply, FastifyRequest } from 'fastify';
import { toPublicUser } from '../../../../domain/entities/user.ts';
import { makeAuthenticateUserUseCase } from '../../../factories/make-authenticate-user-use-case.ts';
import { loginBodySchema } from '../../schemas/auth-schemas.ts';
import { signToken } from './sign-token.ts';

export async function loginController(request: FastifyRequest, reply: FastifyReply) {
  const body = loginBodySchema.parse(request.body);
  const { user } = await makeAuthenticateUserUseCase().execute(body);
  const token = await signToken(reply, user);
  return reply.status(200).send({ user: toPublicUser(user), token });
}
