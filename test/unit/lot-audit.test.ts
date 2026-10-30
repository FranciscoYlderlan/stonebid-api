import { describe, expect, it } from 'vitest';
import type { Receipt } from '../../src/domain/entities/receipt.ts';
import {
  computeBidHash,
  genesisHash,
  pseudonymFor,
  sealBid,
  sealHead,
  sealReceipt,
  type ChainBid,
} from '../../src/domain/integrity/bid-chain.ts';
import { auditLot, type LotAuditInput } from '../../src/domain/integrity/lot-audit.ts';

const secrets = { sealSecret: 'selo-de-teste', pseudonymSecret: 'pseudonimo-de-teste' };
const lotId = '22222222-2222-4222-8222-222222222222';
const ana = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const bruno = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const leiloeiro = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const settledAt = new Date(Date.UTC(2026, 9, 30, 13));

/** Lote liquidado com 3 lances (Ana vence com 12 000), comprovante, DEBIT e CREDIT, íntegros. */
function soldLot(): LotAuditInput {
  const bids: ChainBid[] = [];
  let prevHash = genesisHash(lotId);
  [ana, bruno, ana].forEach((bidderId, index) => {
    const seq = index + 1;
    const amountCents = 10_000 + index * 1_000;
    const createdAt = new Date(Date.UTC(2026, 9, 30, 12, seq, 0, 0));
    const hash = computeBidHash({
      lotId,
      seq,
      pseudonym: pseudonymFor(secrets.pseudonymSecret, lotId, bidderId),
      amountCents,
      createdAt,
      prevHash,
    });
    bids.push({
      seq,
      bidderId,
      amountCents,
      createdAt,
      prevHash,
      hash,
      seal: sealBid(secrets.sealSecret, hash),
    });
    prevHash = hash;
  });
  const last = bids[2]!;
  const fields = {
    publicId: 'AAAAAAAAAAAAAAAAAAAAAA',
    lotId,
    winnerPseudonym: pseudonymFor(secrets.pseudonymSecret, lotId, ana),
    amountCents: 12_000,
    settledAt,
    bidCount: 3,
    finalHash: last.hash,
  };
  const receipt: Receipt = { ...fields, seal: sealReceipt(secrets.sealSecret, fields) };
  return {
    lotId,
    bids,
    head: {
      headSeq: 3,
      headHash: last.hash,
      headSeal: sealHead(secrets.sealSecret, lotId, 3, last.hash),
    },
    currentBidCents: 12_000,
    leaderId: ana,
    auctioneerId: leiloeiro,
    settledAt,
    result: 'SOLD',
    receipt,
    debits: [{ userId: ana, amountCents: 12_000 }],
    credits: [{ userId: leiloeiro, amountCents: 12_000 }],
  };
}

/** O mesmo lote ainda ao vivo: sem liquidação, comprovante, DEBIT nem CREDIT. */
function liveLot(): LotAuditInput {
  return { ...soldLot(), settledAt: null, result: null, receipt: null, debits: [], credits: [] };
}

/** Lote sem lances: cabeça zerada, sem lance atual nem líder. */
function emptyLot(): LotAuditInput {
  return {
    ...liveLot(),
    bids: [],
    head: { headSeq: 0, headHash: null, headSeal: null },
    currentBidCents: null,
    leaderId: null,
  };
}

/** Comprovante com campos trocados e selo refeito (quem tem o segredo): só os campos o pegam. */
function resealed(input: LotAuditInput, change: Partial<Receipt>): LotAuditInput {
  const fields = { ...input.receipt!, ...change };
  return { ...input, receipt: { ...fields, seal: sealReceipt(secrets.sealSecret, fields) } };
}

describe('auditoria do lote: cadeia, cabeça, comprovante e extrato (RF-60, M-12)', () => {
  it('íntegro: ao vivo, liquidado, sem lances e sem vencedor', () => {
    expect(auditLot(liveLot(), secrets)).toEqual({ verdict: 'INTACT', firstInconsistency: null });
    expect(auditLot(soldLot(), secrets)).toEqual({ verdict: 'INTACT', firstInconsistency: null });
    expect(auditLot(emptyLot(), secrets).verdict).toBe('INTACT');
    const noWinner: LotAuditInput = { ...emptyLot(), settledAt, result: 'NO_WINNER' };
    expect(auditLot(noWinner, secrets).verdict).toBe('INTACT');
  });

  it('a cadeia vem primeiro: lance editado aponta o lance, mesmo com comprovante errado', () => {
    const input = soldLot();
    const bids = input.bids.map((bid) => (bid.seq === 2 ? { ...bid, amountCents: 99 } : bid));
    const result = auditLot({ ...input, bids, receipt: { ...input.receipt!, seal: 'x' } }, secrets);
    expect(result).toEqual({
      verdict: 'TAMPERED',
      firstInconsistency: { seq: 2, reason: 'CONTENT_CHANGED' },
    });
  });

  it('cabeça antes do comprovante: último lance apagado → HEAD_MISMATCH sem seq', () => {
    const input = soldLot();
    const result = auditLot({ ...input, bids: input.bids.slice(0, 2) }, secrets);
    expect(result.firstInconsistency).toEqual({ seq: null, reason: 'HEAD_MISMATCH' });
  });

  it('comprovante: selo, contagem, hash final, vencedor e valor → RECEIPT_MISMATCH sem seq', () => {
    const input = soldLot();
    const expected = { seq: null, reason: 'RECEIPT_MISMATCH' };
    const cases: LotAuditInput[] = [
      { ...input, receipt: { ...input.receipt!, amountCents: 11_999 } },
      resealed(input, { bidCount: 2 }),
      resealed(input, { finalHash: input.bids[1]!.hash }),
      resealed(input, { winnerPseudonym: pseudonymFor(secrets.pseudonymSecret, lotId, bruno) }),
      resealed(input, { amountCents: 11_000 }),
      resealed(input, { lotId: '33333333-3333-4333-8333-333333333333' }),
      { ...input, receipt: null },
      { ...liveLot(), receipt: input.receipt },
    ];
    for (const tampered of cases) {
      expect(auditLot(tampered, secrets).firstInconsistency).toEqual(expected);
    }
  });

  it('liquidação × extrato: DEBIT e CREDIT no valor do último lance → SETTLEMENT_MISMATCH sem seq', () => {
    const input = soldLot();
    const expected = { seq: null, reason: 'SETTLEMENT_MISMATCH' };
    const cases: LotAuditInput[] = [
      { ...input, debits: [{ userId: ana, amountCents: 11_000 }] },
      { ...input, debits: [{ userId: bruno, amountCents: 12_000 }] },
      { ...input, debits: [] },
      { ...input, debits: [...input.debits, { userId: ana, amountCents: 12_000 }] },
      { ...liveLot(), debits: [{ userId: ana, amountCents: 12_000 }] },
      // CREDIT do leiloeiro adulterado, de outra pessoa, ausente ou duplicado.
      { ...input, credits: [{ userId: leiloeiro, amountCents: 11_000 }] },
      { ...input, credits: [{ userId: bruno, amountCents: 12_000 }] },
      { ...input, credits: [] },
      { ...input, credits: [...input.credits, { userId: leiloeiro, amountCents: 12_000 }] },
      { ...liveLot(), credits: [{ userId: leiloeiro, amountCents: 12_000 }] },
    ];
    for (const tampered of cases) {
      expect(auditLot(tampered, secrets).firstInconsistency).toEqual(expected);
    }
  });

  it('resultado trocado: NO_WINNER com lances, sem comprovante, DEBIT nem CREDIT → SETTLEMENT_MISMATCH', () => {
    const input = soldLot();
    const expected = { seq: null, reason: 'SETTLEMENT_MISMATCH' };
    const cases: LotAuditInput[] = [
      { ...input, result: 'NO_WINNER', receipt: null, debits: [], credits: [] },
      // Liquidação pela metade (só a hora ou só o resultado).
      { ...liveLot(), settledAt },
      { ...input, settledAt: null },
    ];
    for (const tampered of cases) {
      expect(auditLot(tampered, secrets)).toEqual({
        verdict: 'TAMPERED',
        firstInconsistency: expected,
      });
    }
    // SOLD sem lances: o comprovante, conferido antes, já não tem último lance para bater.
    const soldEmpty: LotAuditInput = { ...emptyLot(), settledAt, result: 'SOLD' };
    expect(auditLot(soldEmpty, secrets).firstInconsistency).toEqual({
      seq: null,
      reason: 'RECEIPT_MISMATCH',
    });
  });

  it('lance atual e líder diferentes do último lance → HEAD_MISMATCH sem seq', () => {
    const expected = { seq: null, reason: 'HEAD_MISMATCH' };
    const cases: LotAuditInput[] = [
      { ...soldLot(), currentBidCents: 11_000 },
      { ...soldLot(), leaderId: bruno },
      { ...liveLot(), currentBidCents: null },
      { ...liveLot(), leaderId: null },
      { ...emptyLot(), currentBidCents: 10_000 },
      { ...emptyLot(), leaderId: ana },
    ];
    for (const tampered of cases) {
      expect(auditLot(tampered, secrets).firstInconsistency).toEqual(expected);
    }
  });

  it('lances fora de ordem na entrada são conferidos em ordem de seq', () => {
    const input = soldLot();
    expect(auditLot({ ...input, bids: [...input.bids].reverse() }, secrets).verdict).toBe('INTACT');
  });
});
