import { describe, expect, it } from 'vitest';
import { minNextBidCents, validateBid, type BiddableLot } from '../../src/domain/entities/bid.ts';
import { getCancelRefusal } from '../../src/domain/entities/lot.ts';

/** T-01: regras do lance (RN-02 a RN-05) e recusa por saldo (RN-07). */
describe('validateBid (T-01, RN-02 a RN-07)', () => {
  const startsAt = new Date('2026-10-30T12:00:00.000Z');
  const endsAt = new Date('2026-10-30T13:00:00.000Z');
  const live = new Date('2026-10-30T12:30:00.000Z');
  const fresh: BiddableLot = {
    startsAt,
    endsAt,
    canceledAt: null,
    startingBidCents: 10_000,
    minIncrementCents: 500,
    currentBidCents: null,
    leaderId: null,
  };
  const withLeader: BiddableLot = { ...fresh, currentBidCents: 12_000, leaderId: 'ana' };

  function check(
    lot: BiddableLot,
    amountCents: number,
    extra: Partial<{ now: Date; bidderId: string; availableCents: number }> = {},
  ) {
    return validateBid({
      lot,
      amountCents,
      bidderId: extra.bidderId ?? 'bruno',
      availableCents: extra.availableCents ?? 1_000_000,
      now: extra.now ?? live,
    });
  }

  it('RN-03: primeiro lance igual ao inicial vale; abaixo é recusado com o mínimo', () => {
    expect(check(fresh, 10_000)).toBeNull();
    expect(check(fresh, 9_999)).toEqual({
      code: 'BID_BELOW_MINIMUM',
      message: 'O primeiro lance precisa ser de pelo menos R$ 100,00 (o lance inicial).',
      details: { minAmountCents: 10_000 },
    });
  });

  it('RN-04: seguinte precisa de atual + incremento', () => {
    expect(minNextBidCents(withLeader)).toBe(12_500);
    expect(check(withLeader, 12_500)).toBeNull();
    expect(check(withLeader, 12_499)).toEqual({
      code: 'BID_BELOW_MINIMUM',
      message: 'O lance precisa ser de pelo menos R$ 125,00 (lance atual + incremento mínimo).',
      details: { minAmountCents: 12_500 },
    });
  });

  it('RN-05: o líder não cobre o próprio lance', () => {
    expect(check(withLeader, 20_000, { bidderId: 'ana' })?.code).toBe('ALREADY_WINNING');
  });

  it('RN-02: janela início ≤ agora < fim; no instante do fim é recusado (Q-04)', () => {
    expect(check(fresh, 10_000, { now: startsAt })).toBeNull();
    expect(check(fresh, 10_000, { now: new Date(startsAt.getTime() - 1) })?.code).toBe(
      'LOT_NOT_STARTED',
    );
    expect(check(fresh, 10_000, { now: new Date(endsAt.getTime() - 1) })).toBeNull();
    expect(check(fresh, 10_000, { now: endsAt })?.code).toBe('LOT_ENDED');
  });

  it('RN-02: lote cancelado não aceita lance, nem antes do início', () => {
    const canceled = { ...fresh, canceledAt: startsAt };
    expect(check(canceled, 10_000)?.code).toBe('LOT_CANCELED');
    expect(check(canceled, 10_000, { now: new Date(0) })?.code).toBe('LOT_CANCELED');
  });

  it('RN-07: lance acima do disponível é recusado com o disponível', () => {
    expect(check(fresh, 20_000, { availableCents: 20_000 })).toBeNull();
    expect(check(fresh, 20_001, { availableCents: 20_000 })).toEqual({
      code: 'INSUFFICIENT_FUNDS',
      message: 'Saldo insuficiente: você tem R$ 200,00 disponíveis para lances.',
      details: { availableCents: 20_000 },
    });
  });

  it('ordem dos motivos: estado do lote, liderança, mínimo e saldo', () => {
    expect(
      check({ ...withLeader, canceledAt: startsAt }, 1, { bidderId: 'ana', availableCents: 0 })
        ?.code,
    ).toBe('LOT_CANCELED');
    expect(check(withLeader, 1, { bidderId: 'ana', availableCents: 0 })?.code).toBe(
      'ALREADY_WINNING',
    );
    expect(check(withLeader, 1, { availableCents: 0 })?.code).toBe('BID_BELOW_MINIMUM');
  });
});

describe('getCancelRefusal (RN-12, M-13, T-10a)', () => {
  const startsAt = new Date('2026-10-30T12:00:00.000Z');
  const endsAt = new Date('2026-10-30T13:00:00.000Z');
  const lot = { startsAt, endsAt, canceledAt: null, headSeq: 0 };

  it('agendado e ao vivo sem lances cancelam', () => {
    expect(getCancelRefusal(lot, new Date(startsAt.getTime() - 1))).toBeNull();
    expect(getCancelRefusal(lot, startsAt)).toBeNull();
  });

  it('com lances (sem o OPC-2), encerrado, no instante do fim ou já cancelado: recusa com motivo', () => {
    expect(getCancelRefusal({ ...lot, headSeq: 1 }, startsAt)).toBe(
      'O lote já tem lances e não pode ser cancelado.',
    );
    expect(getCancelRefusal(lot, endsAt)).toBe('O lote já foi encerrado e não pode ser cancelado.');
    expect(getCancelRefusal({ ...lot, canceledAt: startsAt }, startsAt)).toBe(
      'O lote já está cancelado.',
    );
  });
});
