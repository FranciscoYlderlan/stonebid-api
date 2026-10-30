import type { FastifyReply, FastifyRequest } from 'fastify';
import { makeListShowcaseLotsUseCase } from '../../../factories/make-list-showcase-lots-use-case.ts';
import { toLotDto } from '../../presenters/lot-presenter.ts';

export async function listLotsController(_request: FastifyRequest, reply: FastifyReply) {
  const { now, live, scheduled, ended } = await makeListShowcaseLotsUseCase().execute();
  return reply.status(200).send({
    serverTime: now.toISOString(),
    live: live.map((lot) => toLotDto(lot, now)),
    scheduled: scheduled.map((lot) => toLotDto(lot, now)),
    ended: ended.map((lot) => toLotDto(lot, now)),
  });
}
