import type { Lot } from '../../../domain/entities/lot.ts';
import type {
  SettlementPlan,
  SettlementRepository,
  SettlementResult,
} from '../../../domain/repositories/settlement-repository.ts';
import { prisma } from './prisma-client.ts';
import { isUuid, lockLotRow, lotQuery, toLot, type PrismaTx } from './prisma-lots-repository.ts';

/**
 * Liquidação (RN-11, AD-08), exatamente uma vez: a trava do lote serializa os disparos (agendador
 * e leitura), quem chega depois lê `settledAt` e não grava nada; o índice único do comprovante
 * (`lot_id`) e o índice parcial do DEBIT/CREDIT por lote seguram até um disparo que escape da trava.
 */
export class PrismaSettlementRepository implements SettlementRepository {
  async settle(
    lotId: string,
    plan: (lot: Lot) => SettlementPlan | null,
  ): Promise<SettlementResult | null> {
    if (!isUuid(lotId)) return null;
    return prisma.$transaction(
      async (tx) => {
        if (!(await this.lockLot(tx, lotId))) return null;
        const current = toLot(
          await tx.lot.findUniqueOrThrow({ where: { id: lotId }, ...lotQuery }),
        );

        const decision = plan(current);
        if (!decision) return { lot: current, settled: false };

        if (decision.result === 'SOLD') {
          const { receipt } = decision;
          if (!receipt || current.leaderId === null || current.currentBidCents === null) {
            throw new Error('liquidação SOLD sem líder ou sem comprovante');
          }
          const amountCents = current.currentBidCents;
          // Vencedor: RELEASE do comprometido + DEBIT do valor final (o comprometido é
          // COMMIT − RELEASE; só o DEBIT tiraria o valor duas vezes do disponível). Leiloeiro: CREDIT.
          await tx.walletMovement.createMany({
            data: [
              { userId: current.leaderId, type: 'RELEASE', amountCents, lotId },
              { userId: current.leaderId, type: 'DEBIT', amountCents, lotId },
              { userId: current.auctioneerId, type: 'CREDIT', amountCents, lotId },
            ],
          });
          await tx.receipt.create({ data: receipt });
        }

        const updated = await tx.lot.update({
          where: { id: lotId },
          data: { settledAt: decision.settledAt, result: decision.result },
          ...lotQuery,
        });
        return { lot: toLot(updated), settled: true };
      },
      { maxWait: 10_000, timeout: 15_000 },
    );
  }

  /** Mesma trava do lance e do cancelamento. Protegido para o teste de disparo duplo. */
  protected async lockLot(tx: PrismaTx, lotId: string): Promise<boolean> {
    return lockLotRow(tx, lotId);
  }
}
