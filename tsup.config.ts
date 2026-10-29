import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { server: 'src/server.ts' },
  outDir: 'dist',
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // Dependências de node_modules ficam fora do bundle; só o código do projeto
  // (incluindo o Prisma Client gerado em src/) é empacotado.
  skipNodeModulesBundle: true,
});
