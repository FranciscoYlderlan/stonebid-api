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
 * Ordem dos testes: a cadeia (primeiro lance inconsistente) e a cabeça selada, o comprovante, a
 * liquidação contra o extrato e, por último, lance atual e líder do lote contra o último lance.
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

/** Movimento de liquidação do lote (DEBIT do vencedor ou CREDIT do leiloeiro), como está no extrato. */
export interface AuditMovement {
  userId: string;
  amountCents: number;
}

export interface LotAuditInput {
  lotId: string;
  /** Lances como estão no banco, mesmo adulterados. */
  bids: readonly ChainBid[];
  head: ChainHead;
  /** Lance atual e líder gravados no lote; `null` sem lances. */
  currentBidCents: number | null;
  leaderId: string | null;
  /** Leiloeiro dono do lote (quem recebe o CREDIT da liquidação). */
  auctioneerId: string;
  /** Hora e resultado gravados na liquidação; `null` até liquidar. */
  settledAt: Date | null;
  result: LotResult | null;
  /** Comprovante do lote, se existir. */
  receipt: Receipt | null;
  /** Movimentos DEBIT do extrato ligados ao lote. */
  debits: readonly AuditMovement[];
  /** Movimentos CREDIT do extrato ligados ao lote. */
  credits: readonly AuditMovement[];
}

const INTACT: AuditResult = { verdict: 'INTACT', firstInconsistency: null };

function tampered(seq: number | null, reason: AuditReason): AuditResult {
  return { verdict: 'TAMPERED', firstInconsistency: { seq, reason } };
}

function onlyMovement(
  movements: readonly AuditMovement[],
  userId: string,
  amountCents: number,
): boolean {
  if (movements.length !== 1) return false;
  const [movement] = movements;
  return movement?.userId === userId && movement.amountCents === amountCents;
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
 * Liquidação × lances × extrato (item 5):
 * - `settledAt` e `result` andam juntos (os dois gravados ou os dois `null`);
 * - lote liquidado com lances é sempre `SOLD`, e `SOLD` exige lances (RN-11): trocar o resultado
 *   para `NO_WINNER` e apagar comprovante e DEBIT não passa;
 * - lote arrematado tem um DEBIT só, do licitante do último lance e no valor dele, e um CREDIT só,
 *   do leiloeiro, no mesmo valor; lote não arrematado não tem nenhum dos dois.
 */
function settlementOk(input: LotAuditInput, last: ChainBid | undefined): boolean {
  if ((input.settledAt === null) !== (input.result === null)) return false;
  if (input.result !== null && (input.result === 'SOLD') !== (last !== undefined)) return false;
  if (input.result !== 'SOLD') return input.debits.length === 0 && input.credits.length === 0;
  if (last === undefined) return false;
  return (
    onlyMovement(input.debits, last.bidderId, last.amountCents) &&
    onlyMovement(input.credits, input.auctioneerId, last.amountCents)
  );
}

/**
 * Lance atual e líder (RN-04, RN-07): gravados na mesma transação da cabeça, são o valor e o
 * licitante do último lance; lote sem lances não tem nenhum dos dois.
 */
function leaderOk(input: LotAuditInput, last: ChainBid | undefined): boolean {
  if (last === undefined) return input.currentBidCents === null && input.leaderId === null;
  return input.currentBidCents === last.amountCents && input.leaderId === last.bidderId;
}

export function auditLot(input: LotAuditInput, secrets: ChainSecrets): AuditResult {
  const chain = verifyChain(input.lotId, input.bids, input.head, secrets);
  if (!chain.ok) return tampered(chain.seq, chain.reason);

  // Comprovante, extrato e cabeça não apontam um lance: `seq: null`.
  const last = [...input.bids].sort((a, b) => a.seq - b.seq).at(-1);
  if (!receiptOk(input, last, secrets)) return tampered(null, 'RECEIPT_MISMATCH');
  if (!settlementOk(input, last)) return tampered(null, 'SETTLEMENT_MISMATCH');
  if (!leaderOk(input, last)) return tampered(null, 'HEAD_MISMATCH');
  return INTACT;
}
