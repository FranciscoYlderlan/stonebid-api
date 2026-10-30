import { AuditLotUseCase } from '../../application/use-cases/audit-lot.ts';
import { env } from '../../env/index.ts';
import { PrismaLotAuditReader } from '../repositories/prisma/prisma-lot-audit-reader.ts';
import { PrismaLotsRepository } from '../repositories/prisma/prisma-lots-repository.ts';
import { makeSettleLotUseCase } from './make-settle-lot-use-case.ts';

export function makeAuditLotUseCase(): AuditLotUseCase {
  return new AuditLotUseCase(
    new PrismaLotsRepository(),
    makeSettleLotUseCase(),
    new PrismaLotAuditReader(),
    { sealSecret: env.SEAL_SECRET, pseudonymSecret: env.PSEUDONYM_SECRET },
  );
}
