import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Cadeia de hash dos lances e selos (M-12, decisão "comprovante e hash").
 * - hash do lance: SHA-256 de `JSON.stringify(["v1", lotId, seq, pseudonym, amountCents,
 *   createdAtMs, prevHash])` (array, nunca objeto);
 * - lance 1: `prevHash = SHA-256("genesis:" + lotId)`;
 * - selos: `HMAC-SHA256(segredo, etiqueta + campos)`, com as etiquetas `bid:v1`, `head:v1` e
 *   `receipt:v1`, para um selo de um tipo nunca servir para outro.
 * Tudo em hexadecimal minúsculo.
 */

export type SealTag = 'bid:v1' | 'head:v1' | 'receipt:v1';

export interface BidHashFields {
  lotId: string;
  seq: number;
  pseudonym: string;
  amountCents: number;
  createdAt: Date;
  prevHash: string;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function hmac(secret: string, text: string): string {
  return createHmac('sha256', secret).update(text, 'utf8').digest('hex');
}

export function genesisHash(lotId: string): string {
  return sha256(`genesis:${lotId}`);
}

export function computeBidHash(fields: BidHashFields): string {
  return sha256(
    JSON.stringify([
      'v1',
      fields.lotId,
      fields.seq,
      fields.pseudonym,
      fields.amountCents,
      fields.createdAt.getTime(),
      fields.prevHash,
    ]),
  );
}

/** A função única dos três selos. */
export function seal(secret: string, tag: SealTag, ...fields: Array<string | number>): string {
  return hmac(secret, tag + fields.join(''));
}

export function sealBid(secret: string, hash: string): string {
  return seal(secret, 'bid:v1', hash);
}

export function sealHead(secret: string, lotId: string, seq: number, hash: string): string {
  return seal(secret, 'head:v1', lotId, seq, hash);
}

/** Compara selos em tempo constante. */
export function sameSeal(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Pseudônimo estável do licitante dentro do lote (RN-15, AD-09):
 * `HMAC-SHA256(segredo, "pseudonym:v1" + lotId + bidderId)`, cortado em 4 dígitos hexadecimais
 * maiúsculos. O mesmo licitante tem pseudônimos diferentes em lotes diferentes.
 */
export function pseudonymFor(secret: string, lotId: string, bidderId: string): string {
  const code = hmac(secret, `pseudonym:v1${lotId}${bidderId}`).slice(0, 4).toUpperCase();
  return `Licitante ${code}`;
}

export interface ChainBid {
  seq: number;
  bidderId: string;
  amountCents: number;
  createdAt: Date;
  prevHash: string;
  hash: string;
  seal: string;
}

export interface ChainHead {
  headSeq: number;
  headHash: string | null;
  headSeal: string | null;
}

export interface ChainSecrets {
  sealSecret: string;
  pseudonymSecret: string;
}

export type ChainCheck =
  | { ok: true; count: number }
  | {
      ok: false;
      /** Primeiro lance inconsistente (ou `null` quando o problema é a cabeça do lote). */
      seq: number | null;
      reason: 'GAP' | 'CONTENT_CHANGED' | 'BAD_SEAL' | 'BROKEN_LINK' | 'HEAD_MISMATCH';
    };

/**
 * Recalcula a cadeia do lote (base da auditoria do I4): numeração 1..n sem buracos, hash
 * recalculado igual ao guardado, selo, ligação com o anterior e cabeça do lote.
 */
export function verifyChain(
  lotId: string,
  bids: readonly ChainBid[],
  head: ChainHead,
  secrets: ChainSecrets,
): ChainCheck {
  const ordered = [...bids].sort((a, b) => a.seq - b.seq);
  let prevHash = genesisHash(lotId);

  for (const [index, bid] of ordered.entries()) {
    if (bid.seq !== index + 1) return { ok: false, seq: index + 1, reason: 'GAP' };
    const hash = computeBidHash({
      lotId,
      seq: bid.seq,
      pseudonym: pseudonymFor(secrets.pseudonymSecret, lotId, bid.bidderId),
      amountCents: bid.amountCents,
      createdAt: bid.createdAt,
      prevHash: bid.prevHash,
    });
    if (hash !== bid.hash) return { ok: false, seq: bid.seq, reason: 'CONTENT_CHANGED' };
    if (!sameSeal(sealBid(secrets.sealSecret, bid.hash), bid.seal)) {
      return { ok: false, seq: bid.seq, reason: 'BAD_SEAL' };
    }
    if (bid.prevHash !== prevHash) return { ok: false, seq: bid.seq, reason: 'BROKEN_LINK' };
    prevHash = bid.hash;
  }

  const last = ordered.at(-1);
  const headOk = last
    ? head.headSeq === last.seq &&
      head.headHash === last.hash &&
      head.headSeal !== null &&
      sameSeal(sealHead(secrets.sealSecret, lotId, last.seq, last.hash), head.headSeal)
    : head.headSeq === 0 && head.headHash === null && head.headSeal === null;
  if (!headOk) return { ok: false, seq: null, reason: 'HEAD_MISMATCH' };

  return { ok: true, count: ordered.length };
}
