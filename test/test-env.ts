/**
 * Variáveis dos testes E2E. O banco de teste é separado do de desenvolvimento.
 * No CI, o serviço PostgreSQL do workflow expõe o mesmo endereço.
 */
export const testEnv = {
  NODE_ENV: 'test',
  DATABASE_URL:
    process.env.DATABASE_URL_TEST ?? 'postgresql://postgres:postgres@localhost:5432/stonebid_test',
  JWT_SECRET: 'test-jwt-secret-with-at-least-32-characters',
  CORS_ORIGIN: 'http://localhost:5173',
  SEED_PASSWORD: 'stonebid123',
  MCP_ENABLED: 'true',
  MCP_API_KEY: 'test-mcp-api-key-0123456789',
} as const;
