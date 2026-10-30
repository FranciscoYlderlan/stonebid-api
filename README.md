# stonebid-api

API do **Stonebid**, uma casa de leilões online: o leiloeiro monta lotes, licitantes dão lances ao vivo com saldo simulado, e qualquer pessoa audita o histórico de lances de um lote.

Stack: Node (LTS) · Fastify 5 · TypeScript · Prisma 7 (adapter `pg`) sobre PostgreSQL · zod 4 · Vitest · ESLint + Prettier · Docker · GitHub Actions.

## Rodar localmente

### Com Docker Compose (API + banco + seed)

```bash
cp .env.example .env   # opcional: o Compose tem valores padrão de desenvolvimento
docker compose up --build
```

Sobe o PostgreSQL, roda `prisma migrate deploy` + seed (serviço `migrate`) e depois a API em http://localhost:3333.

### Sem Compose

Requisitos: Node 22+ e um PostgreSQL acessível.

```bash
cp .env.example .env          # ajuste DATABASE_URL, JWT_SECRET, MCP_API_KEY
npm install                   # roda prisma generate no postinstall
npx prisma migrate deploy     # ou npm run db:migrate em desenvolvimento
npm run db:seed               # reexecutável (upsert)
npm run dev                   # http://localhost:3333
```

## Scripts

| Script                                                                 | O que faz                                                                                                                                    |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                                          | Servidor com recarga (tsx watch)                                                                                                             |
| `npm run build` / `npm run start:prod`                                 | Bundle em `dist/` / só o servidor (sem migração)                                                                                             |
| `npm run lint` · `npm run format:check` · `npm run typecheck`          | Qualidade                                                                                                                                    |
| `npm test`                                                             | Testes E2E (Vitest). Aplica as migrations no banco de teste (`stonebid_test`), roda o seed e limpa os usuários criados por testes anteriores |
| `npm run db:migrate` · `npm run db:migrate:deploy` · `npm run db:seed` | Banco                                                                                                                                        |

Os testes usam `postgresql://postgres:postgres@localhost:5432/stonebid_test` por padrão; troque com `DATABASE_URL_TEST`.

## Variáveis de ambiente

Validadas com zod em `src/env/` (o app não sobe com valor inválido). Modelo: `.env.example`.

| Variável              | Obrigatória                  | Padrão        | Uso                                           |
| --------------------- | ---------------------------- | ------------- | --------------------------------------------- |
| `NODE_ENV`            | não                          | `development` | `development`, `test` ou `production`         |
| `PORT`                | não                          | `3333`        | Porta HTTP                                    |
| `HOST`                | não                          | `0.0.0.0`     | Interface de escuta                           |
| `DATABASE_URL`        | sim                          | —             | Conexão PostgreSQL                            |
| `JWT_SECRET`          | sim                          | —             | Segredo do JWT (mín. 32 caracteres)           |
| `CORS_ORIGIN`         | sim                          | —             | Origens liberadas, separadas por vírgula      |
| `SEED_PASSWORD`       | com MCP ligada e para o seed | —             | Senha dos usuários de teste                   |
| `MCP_ENABLED`         | não                          | `false`       | Liga a camada MCP em `/mcp`                   |
| `MCP_API_KEY`         | com MCP ligada               | —             | Chave exigida no `/mcp` (mín. 16 caracteres)  |
| `DEPOSIT_LIMIT_CENTS` | não                          | `1000000`     | Teto por depósito, em centavos (R$ 10.000,00) |

## Autenticação

Sessão por JWT no cabeçalho `Authorization: Bearer <token>`, válido por 7 dias. Senhas com hash bcrypt.

| Rota                  | Body                                                                 | Sucesso                                | Erros                                     |
| --------------------- | -------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------- |
| `POST /auth/register` | `{ name, email, password (mín. 8), role: "AUCTIONEER" \| "BIDDER" }` | 201 `{ user, token }`                  | 400 `VALIDATION_ERROR`, 409 `EMAIL_TAKEN` |
| `POST /auth/login`    | `{ email, password }`                                                | 200 `{ user, token }`                  | 401 `INVALID_CREDENTIALS`                 |
| `GET /auth/me`        | —                                                                    | 200 `{ user }`                         | 401 `UNAUTHORIZED`                        |
| `GET /health`         | —                                                                    | 200 `{ status: "ok" }` (checa o banco) | 503 `SERVICE_UNAVAILABLE`                 |

`user` = `{ id, name, email, role }`. Todo erro segue `{ "error": { "code": "STRING", "message": "texto em pt-BR" } }`. Papel errado em rota protegida por `requireRole` → 403 `FORBIDDEN`.

## Carteira (licitante)

Saldo simulado em **centavos inteiros**. O saldo não é guardado: é derivado do extrato `wallet_movements`, que é só de inserção (nunca update nem delete). Cada movimento tem valor positivo; o sinal vem do tipo:

- **total** = `DEPOSIT` + `CREDIT` + `REFUND` − `DEBIT`
- **comprometido** = `COMMIT` − `RELEASE` (lances em que o licitante lidera; entra com os lances)
- **disponível** = total − comprometido

Só `BIDDER`: leiloeiro → 403 `FORBIDDEN`; sem token → 401 `UNAUTHORIZED`.

| Rota                    | Entrada                                                                            | Sucesso                                                                                                       | Erros                                                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /wallet`           | —                                                                                  | 200 `{ totalCents, committedCents, availableCents, depositLimitCents }`                                       | 401, 403                                                                                                                                             |
| `POST /wallet/deposits` | cabeçalho `Idempotency-Key` (8 a 128 caracteres) + `{ amountCents }` (inteiro > 0) | 201 `{ movement, wallet }`; mesma chave e mesmo valor de novo → 200 com o mesmo `movement`, sem novo depósito | 400 `VALIDATION_ERROR` (sem chave, valor ≤ 0), 400 `DEPOSIT_LIMIT_EXCEEDED` (acima do teto), 409 `IDEMPOTENCY_KEY_REUSED` (mesma chave, outro valor) |
| `GET /wallet/movements` | —                                                                                  | 200 `{ items: [{ id, type, amountCents, lotId, createdAt }] }`, mais recentes primeiro                        | 401, 403                                                                                                                                             |

Idempotência: o banco tem índice único em (`user_id`, `idempotency_key`); duas requisições simultâneas com a mesma chave geram um depósito só. Não há saque. O teto vem de `DEPOSIT_LIMIT_CENTS`.

## Usuários de teste (seed)

Senha: valor de `SEED_PASSWORD` (`stonebid123` no `.env.example`).

| E-mail                     | Papel      |
| -------------------------- | ---------- |
| `leiloeiro@stonebid.dev`   | AUCTIONEER |
| `licitante-1@stonebid.dev` | BIDDER     |
| `licitante-2@stonebid.dev` | BIDDER     |

Os licitantes começam com um depósito de R$ 5.000,00 (chave `seed-deposit-<email>`: rodar o seed de novo não duplica).

## Camada MCP

Com `MCP_ENABLED=true`, a API expõe um servidor MCP (Streamable HTTP, sessão por `mcp-session-id`) em `/mcp`. Toda requisição exige `MCP_API_KEY` em `x-api-key` ou `Authorization: Bearer`; sem ela, 401. Desligada em produção.

```bash
claude mcp add --transport http stonebid http://localhost:3333/mcp --header "x-api-key: <chave>"
```

| Tool               | Rota                    | Observação                                                                          |
| ------------------ | ----------------------- | ----------------------------------------------------------------------------------- |
| `entrar`           | `POST /auth/login`      | `user`: `leiloeiro` \| `licitante-1` \| `licitante-2`. Guarda o token na sessão MCP |
| `health`           | `GET /health`           |                                                                                     |
| `auth_me`          | `GET /auth/me`          | Usa a sessão de `entrar`                                                            |
| `auth_register`    | `POST /auth/register`   |                                                                                     |
| `auth_login`       | `POST /auth/login`      | Só devolve a resposta; não troca a sessão                                           |
| `wallet_get`       | `GET /wallet`           | Licitante (sessão de `entrar`)                                                      |
| `wallet_deposit`   | `POST /wallet/deposits` | `{ amountCents, idempotencyKey }`; a chave vai no cabeçalho `Idempotency-Key`       |
| `wallet_movements` | `GET /wallet/movements` | Licitante (sessão de `entrar`)                                                      |

As tools chamam as rotas reais com `app.inject()` (validação, auth e erros de verdade). Cada rota nova ganha a sua tool em `src/infra/mcp/tools/`.

## Estrutura

```
src/
├── domain/              # entidades, interfaces de repositório, erros de negócio
├── application/use-cases/
├── infra/
│   ├── http/            # controllers, routes, middlewares, schemas, errors
│   ├── mcp/             # plugin /mcp, sessão, tools
│   ├── repositories/    # Prisma (cliente gerado em repositories/prisma/generated/, fora do git)
│   └── factories/
├── env/                 # único lugar que lê process.env
├── types/
├── app.ts
└── server.ts
prisma/                  # schema, migrations, seed
test/e2e/
```
