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

Os testes usam `postgresql://postgres:postgres@localhost:5432/stonebid_test` por padrão; troque com `DATABASE_URL_TEST`. Os testes não chamam a API real de itens: um servidor local imita a AIC (busca, item, imagem, queda e lentidão) e passa pelo adaptador de verdade.

## Variáveis de ambiente

Validadas com zod em `src/env/` (o app não sobe com valor inválido). Modelo: `.env.example`.

| Variável               | Obrigatória                  | Padrão                         | Uso                                                                 |
| ---------------------- | ---------------------------- | ------------------------------ | ------------------------------------------------------------------- |
| `NODE_ENV`             | não                          | `development`                  | `development`, `test` ou `production`                               |
| `PORT`                 | não                          | `3333`                         | Porta HTTP                                                          |
| `HOST`                 | não                          | `0.0.0.0`                      | Interface de escuta                                                 |
| `DATABASE_URL`         | sim                          | —                              | Conexão PostgreSQL                                                  |
| `JWT_SECRET`           | sim                          | —                              | Segredo do JWT (mín. 32 caracteres)                                 |
| `CORS_ORIGIN`          | sim                          | —                              | Origens liberadas, separadas por vírgula                            |
| `SEED_PASSWORD`        | com MCP ligada e para o seed | —                              | Senha dos usuários de teste                                         |
| `MCP_ENABLED`          | não                          | `false`                        | Liga a camada MCP em `/mcp`                                         |
| `MCP_API_KEY`          | com MCP ligada               | —                              | Chave exigida no `/mcp` (mín. 16 caracteres)                        |
| `DEPOSIT_LIMIT_CENTS`  | não                          | `1000000`                      | Teto por depósito, em centavos (R$ 10.000,00)                       |
| `ITEMS_API_BASE_URL`   | não                          | `https://api.artic.edu/api/v1` | API pública de itens (Art Institute of Chicago)                     |
| `ITEMS_IIIF_BASE_URL`  | não                          | `https://www.artic.edu/iiif/2` | Imagens IIIF (reserva, se a resposta não trouxer `config.iiif_url`) |
| `ITEMS_API_TIMEOUT_MS` | não                          | `5000`                         | Timeout de cada chamada à API de itens                              |
| `LOT_IMAGE_MAX_BYTES`  | não                          | `2097152` (2 MB)               | Tamanho máximo da imagem copiada para o banco                       |

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

## Lotes

Rotas protegidas usam `Authorization: Bearer <token>`. Valores em **centavos inteiros**; datas ISO 8601 em UTC.

| Rota                                   | Quem            | Sucesso                                                                                                  | Erros                                                                                                    |
| -------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET /items/search?q=&page=`           | AUCTIONEER      | 200 `{ items: [{ externalId, title, imageUrl, attributes }], page, totalPages }`                         | 502 `EXTERNAL_API_UNAVAILABLE`                                                                           |
| `GET /items/images/:imageId/thumbnail` | público         | 200 miniatura (400 px) baixada pelo servidor no IIIF, `Cache-Control: public, max-age=604800, immutable` | 400 `VALIDATION_ERROR` (id não é UUID), 404 `ITEM_NOT_FOUND`, 502 `EXTERNAL_API_UNAVAILABLE`             |
| `POST /lots`                           | AUCTIONEER      | 201 `lot`                                                                                                | 400 `VALIDATION_ERROR`, 404 `ITEM_NOT_FOUND`, 422 `ITEM_IMAGE_TOO_LARGE`, 502 `EXTERNAL_API_UNAVAILABLE` |
| `GET /lots`                            | público         | 200 `{ serverTime, live, scheduled, ended }`                                                             |                                                                                                          |
| `GET /lots/:id`                        | público         | 200 `{ serverTime, lot }` (cancelado também)                                                             | 404 `LOT_NOT_FOUND`                                                                                      |
| `GET /lots/:id/image`                  | público         | 200 bytes da imagem, `Cache-Control: public, max-age=86400`                                              | 404 `LOT_NOT_FOUND`                                                                                      |
| `GET /auctioneer/lots`                 | AUCTIONEER      | 200 `{ serverTime, items }`, só os lotes do próprio leiloeiro, inclusive cancelados                      |                                                                                                          |
| `POST /lots/:id/cancel`                | AUCTIONEER dono | 200 `lot`                                                                                                | 403 `FORBIDDEN` (não é o dono), 404, 409 `LOT_NOT_CANCELABLE` (encerrado, já cancelado ou com lances)    |

- **Corpo do `POST /lots`:** `{ externalId, startingBidCents, minIncrementCents, startsAt, endsAt }`. O lance inicial é o valor mínimo do lote. O início não pode estar no passado (tolerância de 60 s) e o fim fica pelo menos 5 minutos depois do início. Não há edição de lote.
- **Miniatura da busca:** o `imageUrl` de cada item da busca é relativo à API (`/items/images/{imageId}/thumbnail`), não o IIIF da AIC: no navegador, o IIIF responde com o desafio anti-robô da Cloudflare e o `<img>` falha. A rota é pública porque o `<img>` não manda o JWT, e as imagens são de domínio público. O servidor só aceita id de imagem em UUID e monta a URL no `ITEMS_IIIF_BASE_URL` (sem receber URL do cliente).
- **`lot`** = `{ id, title, attributes, imageUrl: "/lots/{id}/image", startingBidCents, minIncrementCents, currentBidCents, startsAt, originalEndsAt, endsAt, status, canceledAt }`, sem dados do leiloeiro. `attributes` = `{ artist, date, medium, dimensions, placeOfOrigin }` (cada um pode ser `null`).
- **Estado** (`status`) vem do relógio do servidor: `SCHEDULED` antes do início, `LIVE` entre início e fim, `ENDED` a partir do fim, `CANCELED` se o leiloeiro cancelou. Só o cancelamento é gravado. Use `serverTime` para contagens regressivas.
- **Vitrine:** ao vivo pelo fim mais próximo, agendados pelo início mais próximo, encerrados pelo fim mais recente (até 30). Cancelados ficam fora.
- **Cancelamento:** só agendado ou ao vivo e sem lances. A checagem de lances fica atrás da porta `LotBidsReader` (hoje sempre "sem lances"; os lances chegam numa próxima entrega).

### API externa de itens (Art Institute of Chicago)

Só a busca do painel (`GET /items/search`), a miniatura da busca (`GET /items/images/:imageId/thumbnail`) e a criação do lote chamam a API. Ao criar o lote, título, atributos e **a imagem** são copiados para o PostgreSQL; vitrine, detalhe e imagem nunca chamam a API, então seguem de pé se ela cair.

- Sem chave. Cada chamada leva `AIC-User-Agent: stonebid (https://github.com/FranciscoYlderlan/stonebid-api)`, como a [documentação](https://api.artic.edu/docs/) pede.
- Limite da AIC: 60 requisições por minuto por IP (anônimo). A busca guarda resultados por 5 minutos em memória.
- Dados em CC0. Só entram obras com imagem e em domínio público (`is_public_domain`), como a AIC recomenda para uso de imagens.
- Imagem pelo IIIF, no tamanho padrão de 843 px: `{iiif_url}/{image_id}/full/843,/0/default.jpg`.
- Falha de rede, timeout (`ITEMS_API_TIMEOUT_MS`) ou resposta inválida → 502 `EXTERNAL_API_UNAVAILABLE` com mensagem em português, e nada é gravado.

## Usuários de teste (seed)

Senha: valor de `SEED_PASSWORD` (`stonebid123` no `.env.example`).

| E-mail                     | Papel      |
| -------------------------- | ---------- |
| `leiloeiro@stonebid.dev`   | AUCTIONEER |
| `licitante-1@stonebid.dev` | BIDDER     |
| `licitante-2@stonebid.dev` | BIDDER     |

Os licitantes começam com um depósito de R$ 5.000,00 (chave `seed-deposit-<email>`: rodar o seed de novo não duplica).

O seed também cria três lotes do `leiloeiro` (imagens em `prisma/seed-assets/`, sem rede): um ao vivo até 14 dias depois da primeira execução, um agendado para 1 dia depois e um encerrado. Rodar de novo atualiza os dados mas não mexe nas datas.

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
| `items_search`     | `GET /items/search`     | Leiloeiro                                                                           |
| `lots_create`      | `POST /lots`            | Leiloeiro                                                                           |
| `lots_list`        | `GET /lots`             |                                                                                     |
| `lots_get`         | `GET /lots/:id`         |                                                                                     |
| `auctioneer_lots`  | `GET /auctioneer/lots`  | Leiloeiro                                                                           |
| `lots_cancel`      | `POST /lots/:id/cancel` | Leiloeiro dono                                                                      |
| `wallet_get`       | `GET /wallet`           | Licitante (sessão de `entrar`)                                                      |
| `wallet_deposit`   | `POST /wallet/deposits` | `{ amountCents, idempotencyKey }`; a chave vai no cabeçalho `Idempotency-Key`       |
| `wallet_movements` | `GET /wallet/movements` | Licitante (sessão de `entrar`)                                                      |

As tools chamam as rotas reais com `app.inject()` (validação, auth e erros de verdade). Cada rota nova ganha a sua tool em `src/infra/mcp/tools/`.

## Estrutura

```
src/
├── domain/              # entidades, interfaces de repositório e do catálogo de itens, erros de negócio
├── application/use-cases/
├── infra/
│   ├── http/            # controllers, routes, middlewares, schemas, errors
│   ├── mcp/             # plugin /mcp, sessão, tools
│   ├── external/        # adaptador da API de itens (Art Institute of Chicago)
│   ├── repositories/    # Prisma (cliente gerado em repositories/prisma/generated/, fora do git)
│   └── factories/
├── env/                 # único lugar que lê process.env
├── types/
├── app.ts
└── server.ts
prisma/                  # schema, migrations, seed
test/e2e/
```
