import type { ReceiptWithLot } from '../../../domain/entities/receipt.ts';

/** Comprovante público (RF-51): sem nome, e-mail nem id de usuário (RN-15). */
export interface ReceiptDto {
  publicId: string;
  lotId: string;
  title: string;
  imageUrl: string;
  finalAmountCents: number;
  settledAt: string;
  winnerPseudonym: string;
  finalHash: string;
  /** Caminho da auditoria derivado do lote (não é gravado: prenderia o registro ao domínio). */
  auditPath: string;
}

export function toReceiptDto(receipt: ReceiptWithLot): ReceiptDto {
  return {
    publicId: receipt.publicId,
    lotId: receipt.lotId,
    title: receipt.lotTitle,
    imageUrl: `/lots/${receipt.lotId}/image`,
    finalAmountCents: receipt.amountCents,
    settledAt: receipt.settledAt.toISOString(),
    winnerPseudonym: receipt.winnerPseudonym,
    finalHash: receipt.finalHash,
    auditPath: `/lots/${receipt.lotId}/audit`,
  };
}
