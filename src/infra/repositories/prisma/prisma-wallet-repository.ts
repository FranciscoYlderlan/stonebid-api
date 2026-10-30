import type { MovementTotals, WalletMovement } from '../../../domain/entities/wallet.ts';
import type {
  CreateDepositInput,
  WalletRepository,
} from '../../../domain/repositories/wallet-repository.ts';
import { UnauthorizedError } from '../../../domain/errors/unauthorized-error.ts';
import { Prisma } from './generated/client.ts';
import { prisma } from './prisma-client.ts';

/** Extrato só de inserção: este repositório nunca faz update nem delete. */
export class PrismaWalletRepository implements WalletRepository {
  async totalsByType(userId: string): Promise<Partial<MovementTotals>> {
    const groups = await prisma.walletMovement.groupBy({
      by: ['type'],
      where: { userId },
      _sum: { amountCents: true },
    });
    const totals: Partial<MovementTotals> = {};
    for (const group of groups) totals[group.type] = group._sum.amountCents ?? 0;
    return totals;
  }

  async sumSettlementCredits(userId: string): Promise<number> {
    const sum = await prisma.walletMovement.aggregate({
      where: { userId, type: 'CREDIT', lotId: { not: null } },
      _sum: { amountCents: true },
    });
    return sum._sum.amountCents ?? 0;
  }

  async listByUser(userId: string): Promise<WalletMovement[]> {
    return prisma.walletMovement.findMany({
      where: { userId },
      // Sequência global do extrato: ordem estável mesmo com o mesmo horário.
      orderBy: { seq: 'desc' },
    });
  }

  async findByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
  ): Promise<WalletMovement | null> {
    return prisma.walletMovement.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
    });
  }

  async createDeposit(
    data: CreateDepositInput,
  ): Promise<{ movement: WalletMovement; created: boolean }> {
    try {
      const movement = await prisma.walletMovement.create({ data: { ...data, type: 'DEPOSIT' } });
      return { movement, created: true };
    } catch (error) {
      // Duas requisições com a mesma chave ao mesmo tempo: o índice único deixa passar uma só.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.findByIdempotencyKey(data.userId, data.idempotencyKey);
        if (existing) return { movement: existing, created: false };
      }
      // Token válido de um usuário que não existe mais: trata como sessão inválida.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new UnauthorizedError();
      }
      throw error;
    }
  }
}
