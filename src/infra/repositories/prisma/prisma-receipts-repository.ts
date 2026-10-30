import type { ReceiptWithLot } from '../../../domain/entities/receipt.ts';
import type { ReceiptsRepository } from '../../../domain/repositories/receipts-repository.ts';
import { prisma } from './prisma-client.ts';

export class PrismaReceiptsRepository implements ReceiptsRepository {
  async findByPublicId(publicId: string): Promise<ReceiptWithLot | null> {
    const receipt = await prisma.receipt.findUnique({
      where: { publicId },
      include: { lot: { select: { title: true, headSeq: true, headHash: true, result: true } } },
    });
    if (!receipt) return null;
    return {
      publicId: receipt.publicId,
      lotId: receipt.lotId,
      winnerPseudonym: receipt.winnerPseudonym,
      amountCents: receipt.amountCents,
      settledAt: receipt.settledAt,
      bidCount: receipt.bidCount,
      finalHash: receipt.finalHash,
      seal: receipt.seal,
      lotTitle: receipt.lot.title,
      lotHeadSeq: receipt.lot.headSeq,
      lotHeadHash: receipt.lot.headHash,
      lotResult: receipt.lot.result,
    };
  }
}
