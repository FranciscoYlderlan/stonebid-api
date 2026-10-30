import { describe, expect, it } from 'vitest';
import { getLotStatus } from '../../src/domain/entities/lot.ts';

describe('getLotStatus (RN-01, contrato 5.1)', () => {
  const startsAt = new Date('2026-10-30T12:00:00.000Z');
  const endsAt = new Date('2026-10-30T13:00:00.000Z');
  const lot = { startsAt, endsAt, canceledAt: null };

  it('deriva o estado do relógio, com o fim exato já encerrado', () => {
    expect(getLotStatus(lot, new Date('2026-10-30T11:59:59.999Z'))).toBe('SCHEDULED');
    expect(getLotStatus(lot, startsAt)).toBe('LIVE');
    expect(getLotStatus(lot, new Date('2026-10-30T12:59:59.999Z'))).toBe('LIVE');
    expect(getLotStatus(lot, endsAt)).toBe('ENDED');
  });

  it('cancelado vale sobre o relógio', () => {
    const canceled = { ...lot, canceledAt: new Date('2026-10-30T12:10:00.000Z') };
    expect(getLotStatus(canceled, startsAt)).toBe('CANCELED');
    expect(getLotStatus(canceled, endsAt)).toBe('CANCELED');
  });
});
