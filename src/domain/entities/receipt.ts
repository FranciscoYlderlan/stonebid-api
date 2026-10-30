/**
 * Comprovante (RF-51, RF-52, M-12): fotografia selada da liquidação de um lote arrematado.
 * Guarda só o que não se deriva, mais o que a auditoria confere; nenhum dado pessoal (RN-15).
 */
export interface Receipt {
  publicId: string;
  lotId: string;
  winnerPseudonym: string;
  amountCents: number;
  settledAt: Date;
  /** Cabeça da cadeia congelada na liquidação: contagem e hash final. */
  bidCount: number;
  finalHash: string;
  seal: string;
}

/** Comprovante com o título do lote (cópia imutável no lote, RN-13), para a tela pública. */
export interface ReceiptWithLot extends Receipt {
  lotTitle: string;
  /** Cabeça e resultado do lote, para conferir o comprovante contra ele. */
  lotHeadSeq: number;
  lotHeadHash: string | null;
  lotResult: string | null;
}
