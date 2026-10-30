import { buildApp } from './app.ts';
import { SETTLE_BATCH_LIMIT } from './application/use-cases/settle-lot.ts';
import { env } from './env/index.ts';
import { makeSettleLotUseCase } from './infra/factories/make-settle-lot-use-case.ts';
import { prisma } from './infra/repositories/prisma/prisma-client.ts';

/** Intervalo do agendador da liquidação (AD-08). */
const SETTLE_INTERVAL_MS = 5_000;

const app = await buildApp();

/**
 * Agendador da liquidação (AD-08): a cada 5 s liquida até 20 lotes vencidos. Uma rodada por vez;
 * a leitura (GET /lots/:id, /lots, /auctioneer/lots, /me/bids) cobre o tempo em que a instância
 * dorme. Desligado nos testes (que não sobem este arquivo).
 */
function startSettlementScheduler(): NodeJS.Timeout | null {
  if (env.NODE_ENV === 'test') return null;
  const settleLot = makeSettleLotUseCase();
  let running = false;
  return setInterval(() => {
    if (running) return;
    running = true;
    settleLot
      .settleDue(SETTLE_BATCH_LIMIT)
      .then((settled) => {
        for (const { lot } of settled)
          app.log.info({ lotId: lot.id, result: lot.result }, 'lote liquidado');
      })
      .catch((error: unknown) => app.log.error(error, 'falha na rodada de liquidação'))
      .finally(() => {
        running = false;
      });
  }, SETTLE_INTERVAL_MS);
}

const scheduler = startSettlementScheduler();

app.addHook('onClose', async () => {
  if (scheduler) clearInterval(scheduler);
  await prisma.$disconnect();
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info(`${signal} recebido, encerrando`);
    void app.close().then(() => process.exit(0));
  });
}

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
