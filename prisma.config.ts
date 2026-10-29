import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Sem env() estrito: `prisma generate` (postinstall) roda sem banco configurado.
    // Comandos que conectam (migrate, db seed) falham com mensagem clara se faltar.
    url: process.env.DATABASE_URL,
  },
});
