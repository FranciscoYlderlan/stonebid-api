import type { Bid } from '../../../domain/entities/bid.ts';
import type { Role } from '../../../domain/entities/user.ts';
import { computeBalance, type MovementTotals } from '../../../domain/entities/wallet.ts';
import {
  BID_KEY_REUSED_MESSAGE,
  IdempotencyKeyReusedError,
} from '../../../domain/errors/idempotency-key-reused-error.ts';
import type {
  BidderLotSummary,
  BidsRepository,
  LockedBidState,
  PlaceBidRequest,
  PlaceBidResult,
  PlanBid,
} from '../../../domain/repositories/bids-repository.ts';
import { Prisma } from './generated/client.ts';
import { prisma } from './prisma-client.ts';
import { isUuid, lockLotRow, lotQuery, toLot, type PrismaTx } from './prisma-lots-repository.ts';

/** Lances (RN-09, RN-14): só insere lances; nunca edita nem apaga. */
export class PrismaBidsRepository implements BidsRepository {
  async place(request: PlaceBidRequest, plan: PlanBid): Promise<PlaceBidResult | null> {
    if (!isUuid(request.lotId)) return null;
    try {
      return await prisma.$transaction(
        async (tx) => {
          const state = await this.readLockedState(tx, request);
          if (!state) return null;

          const decision = plan(state);
          if (decision === 'replay') {
            if (!state.previous) throw new Error('replay sem lance anterior');
            return { bid: state.previous, lot: state.lot, created: false };
          }

          const { lot } = state;
          const bid = await tx.bid.create({
            data: {
              lotId: lot.id,
              seq: decision.seq,
              bidderId: request.bidderId,
              amountCents: decision.amountCents,
              idempotencyKey: request.idempotencyKey,
              createdAt: decision.createdAt,
              prevHash: decision.prevHash,
              hash: decision.hash,
              seal: decision.seal,
            },
          });

          // RN-07 e RN-08: compromete o valor do novo líder e devolve o do antigo na mesma
          // operação. O RELEASE vai para a carteira do antigo líder sem travá-la: só aumenta o
          // disponível dele, e a ordem fica pela sequência global do extrato.
          await tx.walletMovement.create({
            data: {
              userId: request.bidderId,
              type: 'COMMIT',
              amountCents: decision.amountCents,
              lotId: lot.id,
            },
          });
          if (lot.leaderId !== null && lot.currentBidCents !== null) {
            await tx.walletMovement.create({
              data: {
                userId: lot.leaderId,
                type: 'RELEASE',
                amountCents: lot.currentBidCents,
                lotId: lot.id,
              },
            });
          }

          const updated = await tx.lot.update({
            where: { id: lot.id },
            data: {
              currentBidCents: decision.amountCents,
              leaderId: request.bidderId,
              headSeq: decision.seq,
              headHash: decision.hash,
              headSeal: decision.headSeal,
              // Anti-sniping (RN-10): o fim muda na mesma transação, com o lote travado.
              endsAt: decision.endsAt,
            },
            ...lotQuery,
          });

          return { bid, lot: toLot(updated), created: true };
        },
        // A espera pelas travas conta no timeout: folga para a fila de lances do mesmo lote.
        { maxWait: 10_000, timeout: 15_000 },
      );
    } catch (error) {
      // Mesma chave do mesmo licitante gravada ao mesmo tempo em outro lote: o índice único
      // deixa passar só um lance. (No mesmo lote, a trava já mostra o lance anterior.)
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = JSON.stringify(error.meta ?? {});
        if (target.includes('idempotency_key') || target.includes('idempotencyKey')) {
          throw new IdempotencyKeyReusedError(BID_KEY_REUSED_MESSAGE);
        }
      }
      throw error;
    }
  }

  async listByLot(lotId: string): Promise<Bid[]> {
    if (!isUuid(lotId)) return [];
    return prisma.bid.findMany({ where: { lotId }, orderBy: { seq: 'desc' } });
  }

  async listLotsByBidder(bidderId: string): Promise<BidderLotSummary[]> {
    if (!isUuid(bidderId)) return [];
    const groups = await prisma.bid.groupBy({
      by: ['lotId'],
      where: { bidderId },
      _max: { amountCents: true, createdAt: true },
    });
    return groups
      .map((group) => ({
        lotId: group.lotId,
        maxAmountCents: group._max.amountCents ?? 0,
        lastBidAt: group._max.createdAt ?? new Date(0),
      }))
      .sort(
        (a, b) => b.lastBidAt.getTime() - a.lastBidAt.getTime() || a.lotId.localeCompare(b.lotId),
      );
  }

  /**
   * Trava o lote e depois a carteira do licitante, sempre nessa ordem (nunca o contrário), e lê
   * o estado. `null` se o lote não existe. Protegido para o teste de corrida forçar uma janela.
   */
  protected async readLockedState(
    tx: PrismaTx,
    request: PlaceBidRequest,
  ): Promise<LockedBidState | null> {
    if (!(await this.lockLot(tx, request.lotId))) return null;
    const lot = await tx.lot.findUniqueOrThrow({ where: { id: request.lotId }, ...lotQuery });

    const previous = await tx.bid.findUnique({
      where: {
        bidderId_idempotencyKey: {
          bidderId: request.bidderId,
          idempotencyKey: request.idempotencyKey,
        },
      },
    });

    const bidderRole = await this.lockBidderWallet(tx, request.bidderId);
    const groups = await tx.walletMovement.groupBy({
      by: ['type'],
      where: { userId: request.bidderId },
      _sum: { amountCents: true },
    });
    const totals: Partial<MovementTotals> = {};
    for (const group of groups) totals[group.type] = group._sum.amountCents ?? 0;

    return { lot: toLot(lot), bidderRole, balance: computeBalance(totals), previous };
  }

  /** Serialização por lote (RN-09): `SELECT … FOR UPDATE` na linha do lote. */
  protected async lockLot(tx: PrismaTx, lotId: string): Promise<boolean> {
    return lockLotRow(tx, lotId);
  }

  /**
   * Trava a carteira do licitante (a linha dele em `users`): lances do mesmo licitante em lotes
   * diferentes passam um de cada vez, e o disponível lido vale até o COMMIT. `FOR NO KEY UPDATE`,
   * e não `FOR UPDATE`, porque o RELEASE ao antigo líder checa a chave estrangeira com
   * `FOR KEY SHARE` na linha dele: com `FOR UPDATE`, dois lances cruzados (A cobre B num lote e B
   * cobre A em outro) esperariam um pelo outro. `null` se o usuário não existe.
   */
  protected async lockBidderWallet(tx: PrismaTx, bidderId: string): Promise<Role | null> {
    const rows = await tx.$queryRaw<{ role: Role }[]>`
      SELECT "role"::text AS "role" FROM "users" WHERE "id" = ${bidderId}::uuid FOR NO KEY UPDATE`;
    return rows[0]?.role ?? null;
  }
}
