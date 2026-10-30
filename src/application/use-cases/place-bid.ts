import { type PublicBid, validateBid } from '../../domain/entities/bid.ts';
import type { Lot } from '../../domain/entities/lot.ts';
import { computeBalance, type WalletBalance } from '../../domain/entities/wallet.ts';
import { BidRejectedError } from '../../domain/errors/bid-rejected-error.ts';
import { ForbiddenError } from '../../domain/errors/forbidden-error.ts';
import {
  BID_KEY_REUSED_MESSAGE,
  IdempotencyKeyReusedError,
} from '../../domain/errors/idempotency-key-reused-error.ts';
import { LotNotFoundError } from '../../domain/errors/lot-not-found-error.ts';
import { UnauthorizedError } from '../../domain/errors/unauthorized-error.ts';
import {
  computeBidHash,
  genesisHash,
  pseudonymFor,
  sealBid,
  sealHead,
  type ChainSecrets,
} from '../../domain/integrity/bid-chain.ts';
import type { BidsRepository, NewBid } from '../../domain/repositories/bids-repository.ts';
import type { WalletRepository } from '../../domain/repositories/wallet-repository.ts';

export interface PlaceBidInput {
  lotId: string;
  bidderId: string;
  amountCents: number;
  idempotencyKey: string;
}

export interface PlaceBidOutput {
  bid: PublicBid;
  lot: Lot;
  /** Saldo do licitante depois do lance (RN-07). */
  wallet: WalletBalance;
  /** false no replay da mesma Idempotency-Key: devolve o mesmo lance, sem gravar outro. */
  created: boolean;
  now: Date;
}

/**
 * Dá um lance (RF-33, RN-02 a RN-09, RN-14, RN-18). Tudo numa transação, com o lote e a
 * carteira do licitante travados: valida, grava o lance encadeado por hash, compromete o
 * valor do novo líder, devolve o do antigo e atualiza o lance atual, o líder e a cabeça da
 * cadeia. Dois lances no mesmo lote passam um de cada vez; o segundo é revalidado contra o
 * lance que o primeiro gravou.
 */
export class PlaceBidUseCase {
  constructor(
    private readonly bidsRepository: BidsRepository,
    private readonly walletRepository: WalletRepository,
    private readonly secrets: ChainSecrets,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(input: PlaceBidInput): Promise<PlaceBidOutput> {
    let now = this.clock();

    const result = await this.bidsRepository.place(input, (state) => {
      if (!state.bidderRole) throw new UnauthorizedError();
      if (state.bidderRole !== 'BIDDER') {
        throw new ForbiddenError('Só licitantes dão lances. O leiloeiro nunca dá lance.');
      }

      if (state.previous) {
        const same =
          state.previous.lotId === input.lotId && state.previous.amountCents === input.amountCents;
        if (!same) throw new IdempotencyKeyReusedError(BID_KEY_REUSED_MESSAGE);
        return 'replay';
      }

      // Hora lida com o lote travado: fim e cancelamento não mudam até o COMMIT.
      now = this.clock();
      const rejection = validateBid({
        lot: state.lot,
        bidderId: input.bidderId,
        amountCents: input.amountCents,
        availableCents: state.balance.availableCents,
        now,
      });
      if (rejection) throw new BidRejectedError(rejection);

      return this.chain(state.lot, input, now);
    });

    if (!result) throw new LotNotFoundError();

    const wallet = computeBalance(await this.walletRepository.totalsByType(input.bidderId));
    return {
      bid: {
        seq: result.bid.seq,
        lotId: result.bid.lotId,
        amountCents: result.bid.amountCents,
        pseudonym: pseudonymFor(this.secrets.pseudonymSecret, result.bid.lotId, input.bidderId),
        createdAt: result.bid.createdAt,
      },
      lot: result.lot,
      wallet,
      created: result.created,
      now,
    };
  }

  /** Próximo elo da cadeia (M-12): seq, hash ligado ao anterior, selo do lance e da cabeça. */
  private chain(lot: Lot, input: PlaceBidInput, now: Date): NewBid {
    const seq = lot.headSeq + 1;
    const prevHash = lot.headHash ?? genesisHash(lot.id);
    const pseudonym = pseudonymFor(this.secrets.pseudonymSecret, lot.id, input.bidderId);
    const hash = computeBidHash({
      lotId: lot.id,
      seq,
      pseudonym,
      amountCents: input.amountCents,
      createdAt: now,
      prevHash,
    });
    return {
      seq,
      amountCents: input.amountCents,
      createdAt: now,
      prevHash,
      hash,
      seal: sealBid(this.secrets.sealSecret, hash),
      headSeal: sealHead(this.secrets.sealSecret, lot.id, seq, hash),
    };
  }
}
