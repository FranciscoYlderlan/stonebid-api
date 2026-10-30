import { SettleLotUseCase } from '../../application/use-cases/settle-lot.ts';
import { env } from '../../env/index.ts';
import { PrismaLotsRepository } from '../repositories/prisma/prisma-lots-repository.ts';
import { PrismaSettlementRepository } from '../repositories/prisma/prisma-settlement-repository.ts';
import { makeLotEventsPublisher } from './make-lot-events-publisher.ts';

export function makeSettleLotUseCase(clock?: () => Date): SettleLotUseCase {
  return new SettleLotUseCase(
    new PrismaSettlementRepository(),
    new PrismaLotsRepository(),
    { sealSecret: env.SEAL_SECRET, pseudonymSecret: env.PSEUDONYM_SECRET },
    clock,
    makeLotEventsPublisher(),
  );
}
