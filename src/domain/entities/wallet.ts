/** Tipos de movimento da carteira. O valor é sempre positivo; o sinal vem do tipo. */
export const walletMovementTypes = [
  'DEPOSIT',
  'COMMIT',
  'RELEASE',
  'DEBIT',
  'CREDIT',
  'REFUND',
] as const;

export type WalletMovementType = (typeof walletMovementTypes)[number];

/** Linha do extrato (só de inserção). Dinheiro em centavos inteiros (RN-16). */
export interface WalletMovement {
  id: string;
  /** Ordem do extrato: sequência global crescente (estável entre movimentos do mesmo instante). */
  seq: number;
  userId: string;
  type: WalletMovementType;
  amountCents: number;
  lotId: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
}

/** Saldo derivado dos movimentos (RN-07). */
export interface WalletBalance {
  totalCents: number;
  committedCents: number;
  availableCents: number;
}

export type MovementTotals = Record<WalletMovementType, number>;

/**
 * total = DEPOSIT + CREDIT − DEBIT
 * comprometido = COMMIT − RELEASE − REFUND
 * disponível = total − comprometido
 *
 * O `REFUND` é o estorno do cancelamento (OPC-2, RF-23): libera o comprometido do líder no lote
 * cancelado. O total não muda, porque o dinheiro nunca saiu da carteira; o disponível volta ao
 * de antes do lance.
 */
export function computeBalance(totals: Partial<MovementTotals>): WalletBalance {
  const sum = (type: WalletMovementType) => totals[type] ?? 0;
  const totalCents = sum('DEPOSIT') + sum('CREDIT') - sum('DEBIT');
  const committedCents = sum('COMMIT') - sum('RELEASE') - sum('REFUND');
  return { totalCents, committedCents, availableCents: totalCents - committedCents };
}

/** Visão pública da linha do extrato (sem userId nem chave de idempotência). */
export interface PublicWalletMovement {
  id: string;
  type: WalletMovementType;
  amountCents: number;
  lotId: string | null;
  createdAt: Date;
}

export function toPublicMovement(movement: WalletMovement): PublicWalletMovement {
  return {
    id: movement.id,
    type: movement.type,
    amountCents: movement.amountCents,
    lotId: movement.lotId,
    createdAt: movement.createdAt,
  };
}

/** Formata centavos em reais no padrão brasileiro: 1000000 → "R$ 10.000,00". */
export function formatCentsAsBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    .format(cents / 100)
    .replace(/\s/g, ' ');
}
