import type { Bid } from '../entities/bid.ts';
import type { Lot } from '../entities/lot.ts';
import type { Role } from '../entities/user.ts';
import type { WalletBalance } from '../entities/wallet.ts';

export interface PlaceBidRequest {
  lotId: string;
  bidderId: string;
  amountCents: number;
  idempotencyKey: string;
}

/** O que o repositório lê com o lote e a carteira do licitante travados. */
export interface LockedBidState {
  lot: Lot;
  /** Papel de quem dá o lance; `null` se o usuário não existe mais. */
  bidderRole: Role | null;
  /** Saldo do licitante (RN-07), lido depois de travar a carteira dele. */
  balance: WalletBalance;
  /** Lance já gravado com a mesma Idempotency-Key deste licitante (RN-18), em qualquer lote. */
  previous: Bid | null;
}

/** Lance novo, com hash e selos já calculados, e a cabeça nova do lote. */
export interface NewBid {
  seq: number;
  amountCents: number;
  createdAt: Date;
  prevHash: string;
  hash: string;
  seal: string;
  headSeal: string;
}

/**
 * Decide o lance com o estado travado: devolve o lance novo, `'replay'` para devolver o
 * `previous` sem gravar nada, ou lança o erro da recusa (nada é gravado).
 */
export type PlanBid = (state: LockedBidState) => NewBid | 'replay';

export interface PlaceBidResult {
  bid: Bid;
  /** Lote depois do lance (ou como está, no replay). */
  lot: Lot;
  created: boolean;
}

export interface BidsRepository {
  /**
   * RN-09: numa transação, trava a linha do lote (`FOR UPDATE`) e a carteira do licitante, lê o
   * estado e chama `plan`. Lance novo: grava o lance, o COMMIT do novo líder, o RELEASE do antigo
   * e atualiza o lance atual, o líder e a cabeça da cadeia no lote. Devolve `null` se o lote não
   * existe.
   */
  place(request: PlaceBidRequest, plan: PlanBid): Promise<PlaceBidResult | null>;
  /** Lances do lote, do mais novo para o mais antigo (seq decrescente). */
  listByLot(lotId: string): Promise<Bid[]>;
}
