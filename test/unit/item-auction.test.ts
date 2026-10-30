import { describe, expect, it } from 'vitest';
import { endedLotIds, getItemAuction } from '../../src/domain/entities/item-auction.ts';

describe('getItemAuction (RN-19)', () => {
  const now = new Date('2026-10-30T12:00:00.000Z');
  const at = (iso: string) => new Date(iso);
  const noBids = new Set<string>();

  const scheduled = {
    id: 'scheduled',
    startsAt: at('2026-10-30T13:00:00.000Z'),
    endsAt: at('2026-10-30T14:00:00.000Z'),
    canceledAt: null,
  };
  const live = {
    id: 'live',
    startsAt: at('2026-10-30T11:00:00.000Z'),
    endsAt: at('2026-10-30T13:00:00.000Z'),
    canceledAt: null,
  };
  const ended = {
    id: 'ended',
    startsAt: at('2026-10-30T09:00:00.000Z'),
    endsAt: at('2026-10-30T10:00:00.000Z'),
    canceledAt: null,
  };
  const canceled = { ...live, id: 'canceled', canceledAt: at('2026-10-30T11:30:00.000Z') };

  it('sem lote → livre', () => {
    expect(getItemAuction([], now, noBids)).toBeNull();
  });

  it('agendado prende (com ou sem lance)', () => {
    expect(getItemAuction([scheduled], now, noBids)).toEqual({
      status: 'SCHEDULED',
      lotId: 'scheduled',
    });
  });

  it('ao vivo prende (com ou sem lance)', () => {
    expect(getItemAuction([live], now, noBids)).toEqual({ status: 'LIVE', lotId: 'live' });
    expect(getItemAuction([live], now, new Set(['live']))).toEqual({
      status: 'LIVE',
      lotId: 'live',
    });
  });

  it('encerrado com lances = arrematado → SOLD', () => {
    expect(getItemAuction([ended], now, new Set(['ended']))).toEqual({
      status: 'SOLD',
      lotId: 'ended',
    });
  });

  it('encerrado sem lances libera', () => {
    expect(getItemAuction([ended], now, noBids)).toBeNull();
  });

  it('cancelado libera, mesmo com lance registrado', () => {
    expect(getItemAuction([canceled], now, new Set(['canceled']))).toBeNull();
  });

  it('o fim exato já é encerrado (mesmo relógio do getLotStatus)', () => {
    expect(getItemAuction([live], live.endsAt, noBids)).toBeNull();
    expect(getItemAuction([live], live.endsAt, new Set(['live']))).toEqual({
      status: 'SOLD',
      lotId: 'live',
    });
  });

  it('vários lotes: só os que prendem contam; vendido vale sobre ao vivo e agendado', () => {
    expect(getItemAuction([canceled, ended, scheduled], now, noBids)).toEqual({
      status: 'SCHEDULED',
      lotId: 'scheduled',
    });
    expect(getItemAuction([scheduled, live], now, noBids)?.status).toBe('LIVE');
    expect(getItemAuction([scheduled, live, ended], now, new Set(['ended']))).toEqual({
      status: 'SOLD',
      lotId: 'ended',
    });
  });

  it('endedLotIds: só os encerrados não cancelados (onde o lance muda a resposta)', () => {
    expect(endedLotIds([scheduled, live, ended, canceled], now)).toEqual(['ended']);
  });
});
