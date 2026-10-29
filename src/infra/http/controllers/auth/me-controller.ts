import type { FastifyReply, FastifyRequest } from 'fastify';
import { toPublicUser } from '../../../../domain/entities/user.ts';
import { makeGetUserProfileUseCase } from '../../../factories/make-get-user-profile-use-case.ts';

export async function meController(request: FastifyRequest, reply: FastifyReply) {
  const { user } = await makeGetUserProfileUseCase().execute(request.user.sub);
  return reply.status(200).send({ user: toPublicUser(user) });
}
