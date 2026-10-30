import type { LotResult } from '../entities/lot.ts';
import type { Receipt } from '../entities/receipt.ts';
import {
  pseudonymFor,
  sameSeal,
  sealReceipt,
  verifyChain,
  type ChainBid,
  type ChainHead,
  type ChainSecrets,
} from './bid-chain.ts';

/**
 * Auditoria pública do lote (RF-60, RF-61): recalcula tudo a cada leitura, nada é guardado.
 * Ordem dos testes: a cadeia (primeiro lance inconsistente), a cabeça do lote, o comprovante e,
 * por último, a liquidação contra o extrato.
 */

export type AuditReason =
  | 'GAP'
  | 'CONTENT_CHANGED'
  | 'BAD_SEAL'
  | 'BROKEN_LINK'
  | 'HEAD_MISMATCH'
  | 'RECEIPT_MISMATCH'
  | 'SETTLEMENT_MISMATCH';

export type AuditVerdict = 'INTACT' | 'TAMPERED';

export interface AuditInconsistency {
  /** Lance onde a inconsistência aparece; `null` quando não há lance a apontar. */
  seq: number | null;
  reason: AuditReason;
}

export interface AuditResult {
  verdict: AuditVerdict;
  firstInconsistency: AuditInconsistency | null;
}

/** Movimento DEBIT de liquidação do lote, como está no extrato. */
export interface AuditDebit {
  userId: string;
  amountCents: number;
}

export interface LotAuditInput {
  lotId: string;
  /** Lances como estão no banco, mesmo adulterados. */
  bids: readonly ChainBid[];
  head: ChainHead;
  /** Resultado gravado na liquidação; `null` até liquidar. */
  result: LotResult | null;
  /** Comprovante do lote, se existir. */
  receipt: Receipt | null;
  /** Movimentos DEBIT do extrato ligados ao lote. */
  debits: readonly AuditDebit[];
}

const INTACT: AuditResult = { verdict: 'INTACT', firstInconsistency: null };

function tampered(seq: number | null, reason: AuditReason): AuditResult {
  return { verdict: 'TAMPERED', firstInconsistency: { seq, reason } };
}

/**
 * Comprovante (item 4): existe só em lote arrematado; selo `receipt:v1` confere; contagem, hash
 * final, pseudônimo do vencedor e valor batem com o último lance.
 */
function receiptOk(input: LotAuditInput, last: ChainBid | undefined, secrets: ChainSecrets) {
  const { receipt } = input;
  if (input.result !== 'SOLD') return receipt === null;
  if (receipt === null || last === undefined) return false;
  return (
    receipt.lotId === input.lotId &&
    sameSeal(sealReceipt(secrets.sealSecret, receipt), receipt.seal) &&
    receipt.bidCount === last.seq &&
    receipt.finalHash === last.hash &&
    receipt.winnerPseudonym === pseudonymFor(secrets.pseudonymSecret, input.lotId, last.bidderId) &&
    receipt.amountCents === last.amountCents
  );
}

/**
 * Liquidação × extrato (item 5): lote arrematado tem um DEBIT só, do licitante do último lance e
 * no valor dele; lote não arrematado não tem DEBIT.
 */
function settlementOk(input: LotAuditInput, last: ChainBid | undefined): boolean {
  if (input.result !== 'SOLD') return input.debits.length === 0;
  if (last === undefined || input.debits.length !== 1) return false;
  const [debit] = input.debits;
  return debit?.userId === last.bidderId && debit.amountCents === last.amountCents;
}

export function auditLot(input: LotAuditInput, secrets: ChainSecrets): AuditResult {
  const chain = verifyChain(input.lotId, input.bids, input.head, secrets);
  if (!chain.ok) return tampered(chain.seq, chain.reason);

  const last = [...input.bids].sort((a, b) => a.seq - b.seq).at(-1);
  const lastSeq = last?.seq ?? null;
  if (!receiptOk(input, last, secrets)) return tampered(lastSeq, 'RECEIPT_MISMATCH');
  if (!settlementOk(input, last)) return tampered(lastSeq, 'SETTLEMENT_MISMATCH');
  return INTACT;
}
