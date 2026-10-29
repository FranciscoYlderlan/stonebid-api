import { buildApp } from './app.ts';
import { env } from './env/index.ts';
import { prisma } from './infra/repositories/prisma/prisma-client.ts';

const app = await buildApp();

app.addHook('onClose', async () => {
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
