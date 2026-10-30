import { CancelLotUseCase } from '../../application/use-cases/cancel-lot.ts';
import { env } from '../../env/index.ts';
import { PrismaLotsRepository } from '../repositories/prisma/prisma-lots-repository.ts';
import { makeLotEventsPublisher } from './make-lot-events-publisher.ts';

export function makeCancelLotUseCase(): CancelLotUseCase {
  return new CancelLotUseCase(
    new PrismaLotsRepository(),
    undefined,
    makeLotEventsPublisher(),
    env.CANCEL_WITH_BIDS_ENABLED,
  );
}
