import type { LotAuditReport } from '../../../application/use-cases/audit-lot.ts';
import { pseudonymFor } from '../../../domain/integrity/bid-chain.ts';
import type { AuditInconsistency, AuditVerdict } from '../../../domain/integrity/lot-audit.ts';
import { env } from '../../../env/index.ts';
import { toLotDto, type LotDto } from './lot-presenter.ts';

/** Lance na auditoria: pseudônimo, valor, hora e a cadeia; sem licitante nem selo (RN-15). */
export interface AuditBidDto {
  seq: number;
  pseudonym: string;
  amountCents: number;
  createdAt: string;
  prevHash: string;
  hash: string;
}

/** Resposta de `GET /lots/:id/audit` e da tool `lots_audit` (RF-60). */
export interface LotAuditDto {
  lot: LotDto;
  bids: AuditBidDto[];
  verdict: AuditVerdict;
  firstInconsistency: AuditInconsistency | null;
  checkedAt: string;
}

export function toLotAuditDto(report: LotAuditReport): LotAuditDto {
  const { lot } = report;
  return {
    lot: toLotDto(lot, report.checkedAt, null),
    bids: report.bids.map((bid) => ({
      seq: bid.seq,
      pseudonym: pseudonymFor(env.PSEUDONYM_SECRET, lot.id, bid.bidderId),
      amountCents: bid.amountCents,
      createdAt: bid.createdAt.toISOString(),
      prevHash: bid.prevHash,
      hash: bid.hash,
    })),
    verdict: report.verdict,
    firstInconsistency: report.firstInconsistency,
    checkedAt: report.checkedAt.toISOString(),
  };
}
