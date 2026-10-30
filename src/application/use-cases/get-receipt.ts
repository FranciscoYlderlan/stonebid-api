import type { ReceiptWithLot } from '../../domain/entities/receipt.ts';
import { ReceiptNotFoundError } from '../../domain/errors/receipt-not-found-error.ts';
import {
  RECEIPT_PUBLIC_ID_PATTERN,
  sameSeal,
  sealReceipt,
} from '../../domain/integrity/bid-chain.ts';
import type { ReceiptsRepository } from '../../domain/repositories/receipts-repository.ts';

/**
 * Comprovante público (RF-51, RF-52): só do banco, sem a API externa (RN-13, T-07) e sem dado
 * pessoal (RN-15, T-09). O selo e a conferência com a cabeça congelada do lote têm de bater;
 * inexistente ou adulterado dá o mesmo 404.
 */
export class GetReceiptUseCase {
  constructor(
    private readonly receiptsRepository: ReceiptsRepository,
    private readonly sealSecret: string,
  ) {}

  async execute(publicId: string): Promise<ReceiptWithLot> {
    if (!RECEIPT_PUBLIC_ID_PATTERN.test(publicId)) throw new ReceiptNotFoundError();
    const receipt = await this.receiptsRepository.findByPublicId(publicId);
    if (!receipt) throw new ReceiptNotFoundError();

    const sealOk = sameSeal(sealReceipt(this.sealSecret, receipt), receipt.seal);
    const matchesLot =
      receipt.lotResult === 'SOLD' &&
      receipt.lotHeadSeq === receipt.bidCount &&
      receipt.lotHeadHash === receipt.finalHash;
    if (!sealOk || !matchesLot) throw new ReceiptNotFoundError();

    return receipt;
  }
}
