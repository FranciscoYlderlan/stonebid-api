import { describe, expect, it } from 'vitest';
import { myBidPosition } from '../../src/application/use-cases/list-my-bids.ts';
import { validateBid } from '../../src/domain/entities/bid.ts';
import {
  ANTI_SNIPING_WINDOW_MS,
  extendEndsAt,
  getLotStatus,
  isDueForSettlement,
  type Lot,
} from '../../src/domain/entities/lot.ts';
import {
  newReceiptPublicId,
  RECEIPT_PUBLIC_ID_PATTERN,
  sameSeal,
  sealReceipt,
} from '../../src/domain/integrity/bid-chain.ts';

const endsAt = new Date('2026-10-30T13:00:00.000Z');
const at = (msBeforeEnd: number) => new Date(endsAt.getTime() - msBeforeEnd);

describe('anti-sniping (RN-10, T-04)', () => {
  it('lance a exatamente 2 min do fim: a regra vale, fim = instante do lance + 2 min', () => {
    const now = at(ANTI_SNIPING_WINDOW_MS);
    expect(extendEndsAt(endsAt, now).getTime()).toBe(now.getTime() + ANTI_SNIPING_WINDOW_MS);
  });

  it('lance a 2 min + 1 ms do fim: o fim não muda', () => {
    expect(extendEndsAt(endsAt, at(ANTI_SNIPING_WINDOW_MS + 1))).toBe(endsAt);
  });

  it('dentro da janela o fim vai para lance + 2 min (nunca diminui)', () => {
    expect(extendEndsAt(endsAt, at(ANTI_SNIPING_WINDOW_MS - 1)).getTime()).toBe(
      endsAt.getTime() + 1,
    );
    expect(extendEndsAt(endsAt, at(1)).getTime()).toBe(
      endsAt.getTime() - 1 + ANTI_SNIPING_WINDOW_MS,
    );
    // Sem limite de prorrogações: cada lance na janela empurra o fim de novo.
    const once = extendEndsAt(endsAt, at(1_000));
    const twice = extendEndsAt(once, new Date(once.getTime() - 1_000));
    expect(twice.getTime()).toBeGreaterThan(once.getTime());
  });
});

describe('liquidação: estado do lote (RN-11)', () => {
  const lot = {
    startsAt: new Date('2026-10-30T12:00:00.000Z'),
    endsAt,
    canceledAt: null as Date | null,
    settledAt: null as Date | null,
  };

  it('vencido = fim ≤ agora, sem liquidação nem cancelamento', () => {
    expect(isDueForSettlement(lot, at(1))).toBe(false);
    expect(isDueForSettlement(lot, endsAt)).toBe(true);
    expect(isDueForSettlement({ ...lot, settledAt: endsAt }, at(-1))).toBe(false);
    expect(isDueForSettlement({ ...lot, canceledAt: at(10) }, at(-1))).toBe(false);
  });

  it('liquidado é ENDED e recusa lance com LOT_ENDED, qualquer que seja o relógio', () => {
    const settled = { ...lot, settledAt: endsAt };
    expect(getLotStatus(settled, at(30 * 60 * 1000))).toBe('ENDED');
    const rejection = validateBid({
      lot: {
        ...settled,
        startingBidCents: 100,
        minIncrementCents: 10,
        currentBidCents: null,
        leaderId: null,
      },
      bidderId: 'ana',
      amountCents: 100,
      availableCents: 1_000,
      now: at(30 * 60 * 1000),
    });
    expect(rejection?.code).toBe('LOT_ENDED');
  });
});

describe('meus lances: posição do licitante', () => {
  const base = {
    startsAt: new Date('2026-10-30T12:00:00.000Z'),
    endsAt,
    canceledAt: null,
    settledAt: null,
    result: null,
    leaderId: 'ana',
  } as unknown as Lot;
  const live = at(60_000);

  it('LEADING, OUTBID, WON, LOST e CANCELED', () => {
    expect(myBidPosition(base, 'ana', live)).toBe('LEADING');
    expect(myBidPosition(base, 'bruno', live)).toBe('OUTBID');
    const sold = { ...base, settledAt: endsAt, result: 'SOLD' } as Lot;
    expect(myBidPosition(sold, 'ana', live)).toBe('WON');
    expect(myBidPosition(sold, 'bruno', live)).toBe('LOST');
    expect(myBidPosition({ ...base, canceledAt: live } as Lot, 'ana', live)).toBe('CANCELED');
  });
});

describe('comprovante (M-12)', () => {
  const fields = {
    publicId: newReceiptPublicId(),
    lotId: '11111111-1111-4111-8111-111111111111',
    winnerPseudonym: 'Licitante 7F3A9C',
    amountCents: 35_000,
    settledAt: endsAt,
    bidCount: 3,
    finalHash: 'abc',
  };

  it('identificador público: 16 bytes em base64url (22 caracteres), aleatório', () => {
    expect(fields.publicId).toMatch(RECEIPT_PUBLIC_ID_PATTERN);
    expect(newReceiptPublicId()).not.toBe(fields.publicId);
  });

  it('o selo cobre todos os campos e usa a etiqueta receipt:v1', () => {
    const seal = sealReceipt('segredo', fields);
    expect(sameSeal(sealReceipt('segredo', fields), seal)).toBe(true);
    for (const changed of [
      { ...fields, amountCents: 35_001 },
      { ...fields, winnerPseudonym: 'Licitante 000000' },
      { ...fields, settledAt: new Date(endsAt.getTime() + 1) },
      { ...fields, bidCount: 2 },
      { ...fields, finalHash: 'abd' },
      { ...fields, publicId: newReceiptPublicId() },
    ]) {
      expect(sealReceipt('segredo', changed)).not.toBe(seal);
    }
    expect(sealReceipt('outro-segredo', fields)).not.toBe(seal);
  });
});
