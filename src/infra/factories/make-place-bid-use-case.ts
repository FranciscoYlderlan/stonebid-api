import { PlaceBidUseCase } from '../../application/use-cases/place-bid.ts';
import { env } from '../../env/index.ts';
import { PrismaBidsRepository } from '../repositories/prisma/prisma-bids-repository.ts';
import { PrismaWalletRepository } from '../repositories/prisma/prisma-wallet-repository.ts';
import { makeLotEventsPublisher } from './make-lot-events-publisher.ts';

/** `clock` só para o seed (lote encerrado com lances dados no passado). */
export function makePlaceBidUseCase(clock?: () => Date): PlaceBidUseCase {
  return new PlaceBidUseCase(
    new PrismaBidsRepository(),
    new PrismaWalletRepository(),
    { sealSecret: env.SEAL_SECRET, pseudonymSecret: env.PSEUDONYM_SECRET },
    clock,
    makeLotEventsPublisher(),
  );
}
