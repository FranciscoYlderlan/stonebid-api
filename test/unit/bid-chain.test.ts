import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  computeBidHash,
  genesisHash,
  pseudonymFor,
  seal,
  sealBid,
  sealHead,
  verifyChain,
  type ChainBid,
} from '../../src/domain/integrity/bid-chain.ts';

const secrets = { sealSecret: 'selo-de-teste', pseudonymSecret: 'pseudonimo-de-teste' };
const lotId = '11111111-1111-4111-8111-111111111111';

/** Monta uma cadeia válida de lances, como o PlaceBidUseCase grava. */
function buildChain(entries: Array<{ bidderId: string; amountCents: number }>) {
  const bids: ChainBid[] = [];
  let prevHash = genesisHash(lotId);
  entries.forEach((entry, index) => {
    const seq = index + 1;
    const createdAt = new Date(Date.UTC(2026, 9, 30, 12, 0, 0, seq * 7));
    const hash = computeBidHash({
      lotId,
      seq,
      pseudonym: pseudonymFor(secrets.pseudonymSecret, lotId, entry.bidderId),
      amountCents: entry.amountCents,
      createdAt,
      prevHash,
    });
    bids.push({
      seq,
      ...entry,
      createdAt,
      prevHash,
      hash,
      seal: sealBid(secrets.sealSecret, hash),
    });
    prevHash = hash;
  });
  const last = bids.at(-1)!;
  const head = {
    headSeq: last.seq,
    headHash: last.hash,
    headSeal: sealHead(secrets.sealSecret, lotId, last.seq, last.hash),
  };
  return { bids, head };
}

describe('cadeia de hash e selos (M-12)', () => {
  it('hash = SHA-256 do array em ordem fixa; gênese = SHA-256("genesis:" + lotId)', () => {
    const createdAt = new Date('2026-10-30T12:00:00.123Z');
    const expected = createHash('sha256')
      .update(JSON.stringify(['v1', lotId, 1, 'Licitante 7F3A9C', 500, createdAt.getTime(), 'abc']))
      .digest('hex');
    expect(
      computeBidHash({
        lotId,
        seq: 1,
        pseudonym: 'Licitante 7F3A9C',
        amountCents: 500,
        createdAt,
        prevHash: 'abc',
      }),
    ).toBe(expected);
    expect(genesisHash(lotId)).toBe(createHash('sha256').update(`genesis:${lotId}`).digest('hex'));
  });

  it('selo = HMAC(segredo, etiqueta + campos); etiquetas diferentes dão selos diferentes', () => {
    const hash = 'f'.repeat(64);
    expect(sealBid('s', hash)).toBe(
      createHmac('sha256', 's').update(`bid:v1${hash}`).digest('hex'),
    );
    expect(sealHead('s', lotId, 3, hash)).toBe(
      createHmac('sha256', 's').update(`head:v1${lotId}3${hash}`).digest('hex'),
    );
    expect(seal('s', 'bid:v1', hash)).not.toBe(seal('s', 'head:v1', hash));
  });

  it('pseudônimo: estável no lote, muda entre lotes, código de 6 dígitos em maiúsculas', () => {
    const a = pseudonymFor('segredo', lotId, 'ana');
    expect(a).toMatch(/^Licitante [0-9A-F]{6}$/);
    expect(pseudonymFor('segredo', lotId, 'ana')).toBe(a);
    const code = createHmac('sha256', 'segredo')
      .update(`pseudonym:v1${lotId}ana`)
      .digest('hex')
      .slice(0, 6)
      .toUpperCase();
    expect(a).toBe(`Licitante ${code}`);
    expect(pseudonymFor('segredo', '22222222-2222-4222-8222-222222222222', 'ana')).not.toBe(a);
  });

  it('cadeia íntegra confere; vazia confere com cabeça vazia', () => {
    const { bids, head } = buildChain([
      { bidderId: 'ana', amountCents: 100 },
      { bidderId: 'bruno', amountCents: 200 },
      { bidderId: 'ana', amountCents: 300 },
    ]);
    expect(verifyChain(lotId, bids, head, secrets)).toEqual({ ok: true, count: 3 });
    expect(verifyChain(lotId, [], { headSeq: 0, headHash: null, headSeal: null }, secrets)).toEqual(
      { ok: true, count: 0 },
    );
  });

  it('detecta valor editado, licitante trocado, lance apagado no meio, último apagado e selo errado', () => {
    const { bids, head } = buildChain([
      { bidderId: 'ana', amountCents: 100 },
      { bidderId: 'bruno', amountCents: 200 },
      { bidderId: 'ana', amountCents: 300 },
    ]);
    const edited = bids.map((b) => (b.seq === 2 ? { ...b, amountCents: 150 } : b));
    expect(verifyChain(lotId, edited, head, secrets)).toMatchObject({
      seq: 2,
      reason: 'CONTENT_CHANGED',
    });

    const swapped = bids.map((b) => (b.seq === 1 ? { ...b, bidderId: 'carla' } : b));
    expect(verifyChain(lotId, swapped, head, secrets)).toMatchObject({
      seq: 1,
      reason: 'CONTENT_CHANGED',
    });

    const middle = bids.filter((b) => b.seq !== 2);
    expect(verifyChain(lotId, middle, head, secrets)).toMatchObject({ seq: 2, reason: 'GAP' });

    const truncated = bids.slice(0, 2);
    const forgedHead = { headSeq: 2, headHash: truncated[1]!.hash, headSeal: head.headSeal };
    expect(verifyChain(lotId, truncated, forgedHead, secrets)).toMatchObject({
      reason: 'HEAD_MISMATCH',
    });

    const resealed = bids.map((b) => (b.seq === 3 ? { ...b, seal: sealBid('outro', b.hash) } : b));
    expect(verifyChain(lotId, resealed, head, secrets)).toMatchObject({
      seq: 3,
      reason: 'BAD_SEAL',
    });
  });
});
