# stonebid-api

API do **Stonebid**, uma casa de leilões online: o leiloeiro monta lotes com obras de uma API pública, licitantes dão lances ao vivo com saldo simulado, quem vence recebe um comprovante compartilhável por link, e qualquer pessoa, sem login, audita o histórico de lances de um lote e verifica se ele foi adulterado.

## No ar

| Ambiente | API                                                                                                                             | Web                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Produção | https://stonebid-api-7idhzkkvpq-rj.a.run.app ([`/health`](https://stonebid-api-7idhzkkvpq-rj.a.run.app/health))                 | https://stonebid-web.vercel.app         |
| Staging  | https://stonebid-api-staging-7idhzkkvpq-rj.a.run.app ([`/health`](https://stonebid-api-staging-7idhzkkvpq-rj.a.run.app/health)) | https://stonebid-web-staging.vercel.app |

- Frontend: https://github.com/FranciscoYlderlan/stonebid-web
- Usuários de teste (os dois ambientes): `leiloeiro@stonebid.dev`, `licitante-1@stonebid.dev` e `licitante-2@stonebid.dev`, senha `stonebid123`. Detalhes em [Dados de teste (seed)](#dados-de-teste-seed).
- A camada MCP (`/mcp`) só existe em local e staging; em produção está desligada.
- O staging dorme sem uso: a primeira requisição depois de parado leva alguns segundos.

## Stack

Node 22+ (imagem Docker no Node 24) · Fastify 5 · TypeScript · Prisma 7 (adapter `pg`) sobre PostgreSQL · zod 4 · JWT (`@fastify/jwt`) · bcrypt · SDK do MCP · Vitest · ESLint + Prettier · Docker · GitHub Actions · Cloud Run + Cloud SQL (GCP).

## Arquitetura

Camadas no estilo limpo, com a dependência sempre apontando para dentro:

- **`src/domain/`:** entidades e regras puras (lance, estado do lote, anti-sniping, cadeia de hash, auditoria), erros de negócio e as interfaces (portas) de repositório e do catálogo de itens. Não importa Fastify, Prisma nem nada de `infra/`.
- **`src/application/use-cases/`:** um caso de uso por ação (dar lance, liquidar, cancelar, auditar…). Recebe repositórios e relógio por construtor, então os testes trocam o relógio e o banco.
- **`src/infra/`:** o que fala com o mundo: rotas e controllers HTTP, repositórios Prisma (transações e travas), adaptador da API do Art Institute of Chicago, barramento do tempo real (SSE), camada MCP e as factories que montam cada caso de uso.

A árvore completa está em [Estrutura](#estrutura).

## Regras de negócio (resumo)

Cada item tem a seção própria abaixo, com os detalhes e os códigos de erro.

- **Lance:** só licitante, só com o lote ao vivo; o primeiro lance é pelo menos o lance inicial, os seguintes pelo menos o atual + o incremento; quem lidera não cobre o próprio lance. Ver [Lances](#lances).
- **Saldo comprometido:** quem lidera um lote tem o valor do lance preso; ao ser superado, o valor volta na hora. Um lance só passa se couber no disponível (total − comprometido), somando todos os lotes. Ver [Carteira](#carteira-licitante).
- **Anti-sniping:** lance nos últimos 2 minutos empurra o fim para 2 minutos depois do lance, sem limite de prorrogações. Ver [Lances](#lances).
- **Liquidação:** no fim, o vencedor paga, o leiloeiro recebe e nasce o comprovante público. Ver [Liquidação e comprovante](#liquidação-e-comprovante).
- **Cancelamento:** só o leiloeiro dono, com motivo, antes do fim. Com lances (OPC-2, `CANCEL_WITH_BIDS_ENABLED`), o líder recebe estorno (`REFUND`) do lance atual e nenhum saldo fica preso. Ver [Estorno no cancelamento](#estorno-no-cancelamento-opc-2).
- **Uma obra, um lote:** a mesma obra não fica em dois lotes ativos ou arrematados. Ver [Lotes](#lotes).
- **Histórico à prova de adulteração:** cadeia de hash selada, conferida a cada acesso. Ver [Auditoria](#auditoria).

## Rodar localmente

### Com Docker Compose (API + banco + seed)

```bash
cp .env.example .env   # opcional: o Compose tem valores padrão de desenvolvimento
docker compose up --build
```

Sobe o PostgreSQL 18 (porta 5432, banco `stonebid`, usuário e senha `postgres`), roda `prisma migrate deploy` + seed (serviço `migrate`, que termina) e depois a API em http://localhost:3333, com a MCP ligada. No Compose o `DATABASE_URL` é fixo no `docker-compose.yml` (host `db`); os segredos vêm do `.env`, se existir, ou dos padrões de desenvolvimento do arquivo. Conferir: `curl http://localhost:3333/health` → `{"status":"ok"}`.

### Sem Compose

Requisitos: Node 22+ e um PostgreSQL acessível (o CI usa o 18).

```bash
cp .env.example .env          # ajuste DATABASE_URL, JWT_SECRET, SEAL_SECRET, PSEUDONYM_SECRET, MCP_API_KEY
createdb -U postgres stonebid # se o banco ainda não existir
npm install                   # roda prisma generate no postinstall
npx prisma migrate deploy     # ou npm run db:migrate em desenvolvimento
npm run db:seed               # reexecutável (upsert)
npm run dev                   # http://localhost:3333
```

**Banco:** o app lê só o `DATABASE_URL` (formato `postgresql://usuario:senha@host:5432/banco`). Os segredos precisam de pelo menos 32 caracteres (`openssl rand -hex 32`); com `MCP_ENABLED=true`, `MCP_API_KEY` e `SEED_PASSWORD` também são obrigatórias. Valor inválido derruba a subida com a lista do que falta.

## Testes

```bash
createdb -U postgres stonebid_test   # uma vez; com o Compose: docker compose exec db createdb -U postgres stonebid_test
npm test                             # unitários + E2E (Vitest)
npm run lint && npm run format:check && npm run typecheck
```

Os E2E sobem a aplicação com `buildApp()` e usam um PostgreSQL de verdade, por padrão `postgresql://postgres:postgres@localhost:5432/stonebid_test` (troque com `DATABASE_URL_TEST`). Antes da suíte, `test/global-setup.ts` aplica as migrations, roda o seed e apaga só o que testes anteriores criaram. Os arquivos rodam um de cada vez, porque dividem o banco. Nenhum teste chama a API real de itens: um servidor local imita a AIC (busca, item, imagem, queda e lentidão) e passa pelo adaptador de verdade.

Testes de aceite (T-xx), marcados no nome do `describe`/`it`:

| Teste | O que prova                                                                                | Onde                                                                |
| ----- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| T-01  | Regras do lance: mínimo, líder, agendado, encerrado, instante do fim, cancelado, saldo     | `test/unit/bid-rules.test.ts`, `test/e2e/place-bid.test.ts`         |
| T-02  | Concorrência: 12 lances simultâneos no mesmo lote, sem corrida                             | `test/e2e/place-bid.test.ts`                                        |
| T-03  | Saldo comprometido entre lotes (o exemplo da Ana, passos 1 a 5, e o estorno no passo 6)    | `test/e2e/place-bid.test.ts`                                        |
| T-04  | Anti-sniping, puro e com banco                                                             | `test/unit/settlement-rules.test.ts`, `test/e2e/settlement.test.ts` |
| T-05  | Liquidação: vencedor, crédito do leiloeiro, comprovante, idempotência                      | `test/e2e/settlement.test.ts`                                       |
| T-06  | Auditoria: adulteração por SQL direto em cada ponto da cadeia, do comprovante e do extrato | `test/e2e/audit.test.ts`, `test/unit/lot-audit.test.ts`             |
| T-07  | API externa fora do ar: vitrine, detalhe, imagem e comprovante seguem de pé                | `test/e2e/lots.test.ts`, `test/e2e/receipts-and-my-bids.test.ts`    |
| T-08  | Papéis e posse: leiloeiro não dá lance, só o dono cancela                                  | `test/e2e/bids.test.ts`, `test/e2e/lots.test.ts`                    |
| T-09  | Privacidade: respostas públicas só com pseudônimo, sem nome, e-mail nem id do usuário      | `test/e2e/bids.test.ts`, `audit.test.ts`, `receipts-and-my-bids…`   |
| T-10a | Cancelamento × lance ao mesmo tempo, sem o OPC-2: só um passa                              | `test/unit/bid-rules.test.ts`, `test/e2e/place-bid.test.ts`         |
| T-10b | Cancelamento com lances (OPC-2): estorno do líder, corrida, liquidação e auditoria         | `test/unit/bid-rules.test.ts`, `place-bid.test.ts`, `audit.test.ts` |
| T-11  | Idempotência: mesma `Idempotency-Key` repetida ou em paralelo gera um depósito ou lance só | `test/e2e/wallet.test.ts`, `test/e2e/place-bid.test.ts`             |

## Scripts

| Script                                                                 | O que faz                                                                         |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `npm run dev`                                                          | Servidor com recarga (tsx watch)                                                  |
| `npm run build` / `npm run start:prod`                                 | Bundle em `dist/` / só o servidor (sem migração)                                  |
| `npm run lint` · `npm run format:check` · `npm run typecheck`          | Qualidade                                                                         |
| `npm test`                                                             | Testes unitários e E2E (Vitest), no banco `stonebid_test` (ver [Testes](#testes)) |
| `npm run db:migrate` · `npm run db:migrate:deploy` · `npm run db:seed` | Banco                                                                             |

## Variáveis de ambiente

Validadas com zod em `src/env/` (o app não sobe com valor inválido). Modelo: `.env.example`.

| Variável                   | Obrigatória                  | Padrão                         | Uso                                                                 |
| -------------------------- | ---------------------------- | ------------------------------ | ------------------------------------------------------------------- |
| `NODE_ENV`                 | não                          | `development`                  | `development`, `test` ou `production`                               |
| `PORT`                     | não                          | `3333`                         | Porta HTTP                                                          |
| `HOST`                     | não                          | `0.0.0.0`                      | Interface de escuta                                                 |
| `DATABASE_URL`             | sim                          | —                              | Conexão PostgreSQL                                                  |
| `JWT_SECRET`               | sim                          | —                              | Segredo do JWT (mín. 32 caracteres)                                 |
| `SEAL_SECRET`              | sim                          | —                              | Segredo do HMAC dos selos de lance, cabeça e comprovante (mín. 32)  |
| `PSEUDONYM_SECRET`         | sim                          | —                              | Segredo do pseudônimo do licitante no lote (mín. 32), outro segredo |
| `CORS_ORIGIN`              | sim                          | —                              | Origens liberadas, separadas por vírgula                            |
| `SEED_PASSWORD`            | com MCP ligada e para o seed | —                              | Senha dos usuários de teste                                         |
| `MCP_ENABLED`              | não                          | `false`                        | Liga a camada MCP em `/mcp`                                         |
| `MCP_API_KEY`              | com MCP ligada               | —                              | Chave exigida no `/mcp` (mín. 16 caracteres)                        |
| `DEPOSIT_LIMIT_CENTS`      | não                          | `1000000`                      | Teto por depósito, em centavos (R$ 10.000,00)                       |
| `CANCEL_WITH_BIDS_ENABLED` | não                          | `false`                        | OPC-2: cancelar lote com lances, com estorno ao líder               |
| `ITEMS_API_BASE_URL`       | não                          | `https://api.artic.edu/api/v1` | API pública de itens (Art Institute of Chicago)                     |
| `ITEMS_IIIF_BASE_URL`      | não                          | `https://www.artic.edu/iiif/2` | Imagens IIIF (reserva, se a resposta não trouxer `config.iiif_url`) |
| `ITEMS_API_TIMEOUT_MS`     | não                          | `5000`                         | Timeout de cada chamada à API de itens                              |
| `LOT_IMAGE_MAX_BYTES`      | não                          | `2097152` (2 MB)               | Tamanho máximo da imagem copiada para o banco                       |

## Autenticação

Sessão por JWT no cabeçalho `Authorization: Bearer <token>`, válido por 7 dias. Senhas com hash bcrypt.

| Rota                  | Body                                                                 | Sucesso                                | Erros                                     |
| --------------------- | -------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------- |
| `POST /auth/register` | `{ name, email, password (mín. 8), role: "AUCTIONEER" \| "BIDDER" }` | 201 `{ user, token }`                  | 400 `VALIDATION_ERROR`, 409 `EMAIL_TAKEN` |
| `POST /auth/login`    | `{ email, password }`                                                | 200 `{ user, token }`                  | 401 `INVALID_CREDENTIALS`                 |
| `GET /auth/me`        | —                                                                    | 200 `{ user }`                         | 401 `UNAUTHORIZED`                        |
| `GET /health`         | —                                                                    | 200 `{ status: "ok" }` (checa o banco) | 503 `SERVICE_UNAVAILABLE`                 |

`user` = `{ id, name, email, role }`. Todo erro segue `{ "error": { "code": "STRING", "message": "texto em pt-BR" } }`. Papel errado em rota protegida por `requireRole` → 403 `FORBIDDEN`.

## Dados de teste (seed)

`npm run db:seed` (ou o serviço `migrate` do Compose, ou o Cloud Run Job do deploy) cria tudo abaixo. Não usa rede. Senha dos três usuários: valor de `SEED_PASSWORD` (`stonebid123` no `.env.example` e nos ambientes no ar).

| E-mail                     | Papel      |
| -------------------------- | ---------- |
| `leiloeiro@stonebid.dev`   | AUCTIONEER |
| `licitante-1@stonebid.dev` | BIDDER     |
| `licitante-2@stonebid.dev` | BIDDER     |

Os licitantes começam com um depósito de R$ 5.000,00 (chave `seed-deposit-<email>`: rodar o seed de novo não duplica).

O seed também cria três lotes do `leiloeiro` (obras fictícias, `externalId` `seed-1` a `seed-3`) (imagens em `prisma/seed-assets/`, sem rede): um ao vivo até 14 dias depois da primeira execução, um agendado para 1 dia depois e um encerrado com lances e comprovante. Rodar de novo atualiza os dados mas não mexe nas datas.

No lote ao vivo, o seed dá três lances pelo mesmo caso de uso da API (R$ 500,00 do `licitante-1`, R$ 550,00 do `licitante-2` e R$ 600,00 do `licitante-1`), com chaves `seed-bid-1` a `seed-bid-3`: rodar de novo não duplica. Se o lote já encerrou ou recebeu lances maiores, o seed pula o lance e segue.

No lote encerrado, o seed dá três lances com o relógio injetado dentro da janela gravada do lote (R$ 300,00 do `licitante-2`, R$ 325,00 do `licitante-1` e R$ 350,00 do `licitante-2`, chaves `seed-ended-bid-1` a `seed-ended-bid-3`) e liquida o lote pelo próprio caso de uso no instante do fim: o `licitante-2` vence e o lote tem comprovante. A liquidação é idempotente.

A migration `20261030110000_reset_bids_pseudonym_6` apagou, uma vez, os lances e os movimentos `COMMIT`/`RELEASE` ligados a lance e zerou a cabeça dos lotes, porque o pseudônimo passou a 6 dígitos e entra no hash (com o aval do humano em 2026-10-30). Usuários, lotes e depósitos ficaram; o seed refaz os lances.

## Carteira (licitante)

Saldo simulado em **centavos inteiros**. O saldo não é guardado: é derivado do extrato `wallet_movements`, que é só de inserção (nunca update nem delete). Cada movimento tem valor positivo; o sinal vem do tipo:

- **total** = `DEPOSIT` + `CREDIT` − `DEBIT`
- **comprometido** = `COMMIT` − `RELEASE` − `REFUND` (soma dos lances em que o licitante lidera agora, fora dos lotes cancelados)
- **disponível** = total − comprometido

Só `BIDDER`: leiloeiro → 403 `FORBIDDEN`; sem token → 401 `UNAUTHORIZED`.

| Rota                    | Entrada                                                                            | Sucesso                                                                                                       | Erros                                                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /wallet`           | —                                                                                  | 200 `{ totalCents, committedCents, availableCents, depositLimitCents }`                                       | 401, 403                                                                                                                                             |
| `POST /wallet/deposits` | cabeçalho `Idempotency-Key` (8 a 128 caracteres) + `{ amountCents }` (inteiro > 0) | 201 `{ movement, wallet }`; mesma chave e mesmo valor de novo → 200 com o mesmo `movement`, sem novo depósito | 400 `VALIDATION_ERROR` (sem chave, valor ≤ 0), 400 `DEPOSIT_LIMIT_EXCEEDED` (acima do teto), 409 `IDEMPOTENCY_KEY_REUSED` (mesma chave, outro valor) |
| `GET /wallet/movements` | —                                                                                  | 200 `{ items: [{ id, type, amountCents, lotId, createdAt }] }`, mais recentes primeiro (pela sequência)       | 401, 403                                                                                                                                             |

Idempotência: o banco tem índice único em (`user_id`, `idempotency_key`); duas requisições simultâneas com a mesma chave geram um depósito só. Não há saque. O teto vem de `DEPOSIT_LIMIT_CENTS`.

O extrato é ordenado por uma sequência global crescente (`seq`), não pelo horário: o lance grava o `COMMIT` do novo líder e o `RELEASE` do antigo no mesmo instante, e a sequência mantém a ordem estável.

## Lotes

Rotas protegidas usam `Authorization: Bearer <token>`. Valores em **centavos inteiros**; datas ISO 8601 em UTC.

| Rota                                   | Quem            | Sucesso                                                                                                  | Erros                                                                                                                                                                                        |
| -------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /items/search?q=&page=`           | AUCTIONEER      | 200 `{ items: [{ externalId, title, imageUrl, attributes, auction }], page, totalPages }`                | 502 `EXTERNAL_API_UNAVAILABLE`                                                                                                                                                               |
| `GET /items/images/:imageId/thumbnail` | público         | 200 miniatura (400 px) baixada pelo servidor no IIIF, `Cache-Control: public, max-age=604800, immutable` | 400 `VALIDATION_ERROR` (id não é UUID), 404 `ITEM_NOT_FOUND`, 429 `TOO_MANY_REQUESTS` (120/min por IP), 502 `EXTERNAL_API_UNAVAILABLE`                                                       |
| `POST /lots`                           | AUCTIONEER      | 201 `lot`                                                                                                | 400 `VALIDATION_ERROR`, 404 `ITEM_NOT_FOUND`, 409 `ITEM_ALREADY_AUCTIONED`, 422 `ITEM_IMAGE_TOO_LARGE`, 502 `EXTERNAL_API_UNAVAILABLE`                                                       |
| `GET /lots`                            | público         | 200 `{ serverTime, live, scheduled, ended }`                                                             |                                                                                                                                                                                              |
| `GET /lots/:id`                        | público         | 200 `{ serverTime, lot }` (cancelado também)                                                             | 404 `LOT_NOT_FOUND`                                                                                                                                                                          |
| `GET /lots/:id/image`                  | público         | 200 bytes da imagem, `Cache-Control: public, max-age=86400`                                              | 404 `LOT_NOT_FOUND`                                                                                                                                                                          |
| `GET /auctioneer/lots`                 | AUCTIONEER      | 200 `{ serverTime, items, totalReceivedCents }`, só os lotes do próprio leiloeiro, inclusive cancelados  |                                                                                                                                                                                              |
| `POST /lots/:id/cancel`                | AUCTIONEER dono | body `{ reason }` (3 a 280 caracteres) → 200 `lot`                                                       | 422 `VALIDATION_ERROR` (motivo), 403 `FORBIDDEN` (não é o dono), 404, 409 `LOT_ENDED` (encerrado ou liquidado), 409 `LOT_NOT_CANCELABLE` (já cancelado; com lances só com o OPC-2 desligado) |
| `GET /receipts/:publicId`              | público         | 200 `{ receipt }` (abaixo)                                                                               | 404 `RECEIPT_NOT_FOUND` (inexistente ou adulterado)                                                                                                                                          |

- **Corpo do `POST /lots`:** `{ externalId, startingBidCents, minIncrementCents, startsAt, endsAt }`. O lance inicial é o valor mínimo do lote. O início não pode estar no passado (tolerância de 60 s) e o fim fica pelo menos 5 minutos depois do início. Não há edição de lote.
- **Miniatura da busca:** o `imageUrl` de cada item da busca é relativo à API (`/items/images/{imageId}/thumbnail`), não o IIIF da AIC: no navegador, o IIIF responde com o desafio anti-robô da Cloudflare e o `<img>` falha. A rota é pública porque o `<img>` não manda o JWT, e as imagens são de domínio público. O servidor só aceita id de imagem em UUID e monta a URL no `ITEMS_IIIF_BASE_URL` (sem receber URL do cliente).
- **`lot`** = `{ id, title, attributes, imageUrl: "/lots/{id}/image", startingBidCents, minIncrementCents, currentBidCents, minNextBidCents, leaderPseudonym, startsAt, originalEndsAt, endsAt, status, canceledAt, cancelReason, result, settledAt, receiptPublicId, viewer }`, sem dados do leiloeiro nem do líder. `result` é `SOLD` ou `NO_WINNER` depois da liquidação (antes, `null`); `receiptPublicId` só com `SOLD`. `viewer` = `{ pseudonym }` só em `GET /lots/:id` com JWT válido de licitante (autenticação opcional: sem token ou token inválido dá `null`, nunca 401); em todas as outras respostas é `null`. `attributes` = `{ artist, date, medium, dimensions, placeOfOrigin }` (cada um pode ser `null`). `currentBidCents` e `leaderPseudonym` são `null` sem lances; `minNextBidCents` é o menor lance aceito agora (o lance inicial sem lances; senão o atual + o incremento).
- **Uma obra, um lote (RN-19):** criar lote de uma obra que já tem lote agendado, ao vivo ou arrematado (encerrado com lances) → 409 `ITEM_ALREADY_AUCTIONED`, com `error.details = { status: "SCHEDULED" | "LIVE" | "SOLD", lotId }` do lote que prende a obra. Lote cancelado ou encerrado sem lances libera a obra. Pedidos simultâneos da mesma obra criam um lote só. Na busca, `auction` mostra a mesma situação (`{ status, lotId }`) ou `null` se a obra está livre.
- **Estado** (`status`) vem do relógio do servidor: `SCHEDULED` antes do início, `LIVE` entre início e fim, `ENDED` a partir do fim (e sempre depois de liquidado), `CANCELED` se o leiloeiro cancelou. Cancelamento e liquidação são gravados. Use `serverTime` para contagens regressivas.
- **Vitrine:** ao vivo pelo fim mais próximo, agendados pelo início mais próximo, encerrados pelo fim mais recente (até 30). Cancelados ficam fora.
- **Cancelamento:** só agendado ou ao vivo, sempre com motivo (`cancelReason`, sem espaços nas pontas); com lances, só com o OPC-2 ligado, e o líder recebe estorno (subseção abaixo). Lances, fim e cancelamento anterior são lidos com a linha do lote travada, a mesma trava do lance: cancelamento e lance ao mesmo tempo nunca deixam lance preso num lote cancelado.

### Estorno no cancelamento (OPC-2)

Com `CANCEL_WITH_BIDS_ENABLED=true` (ligado em produção e staging pelo `cd.yml`; padrão `false`), o leiloeiro dono também cancela lote **com lances**, antes do fim e com motivo. Rota e erros não mudam: `POST /lots/:id/cancel { reason }`; com lances, o 409 `LOT_NOT_CANCELABLE` fica só para "já cancelado". Desligado, lote com lances segue recusado com 409 `LOT_NOT_CANCELABLE`.

- **Na mesma transação e trava do cancelamento**, além de `canceledAt` e `cancelReason`, grava um movimento `REFUND` do líder no valor do lance atual (`lotId` do lote). Líder, lance atual e cabeça da cadeia ficam como estavam.
- **O estorno libera o comprometido:** `comprometido = COMMIT − RELEASE − REFUND` e `total = DEPOSIT + CREDIT − DEBIT`. O total do líder não muda e o disponível volta ao de antes do lance. Superados já tinham `RELEASE` e não recebem nada; o leiloeiro também não.
- **Concorrência:** lance e cancelamento usam a mesma trava do lote. Lance que chega antes entra no estorno; lance que chega depois recebe 409 `LOT_CANCELED`. Nenhum comprometido fica preso.
- **Depois:** a liquidação ignora o lote, `GET /me/bids` mostra `CANCELED` e o evento SSE `canceled` avisa a sala.
- **Auditoria:** lote cancelado com lances tem exatamente um `REFUND`, do licitante do último lance e no valor dele; qualquer outro lote, nenhum. Apagado, duplicado ou fora disso → `TAMPERED` com `CANCEL_MISMATCH`.

## Lances

| Rota                  | Quem    | Entrada                                                                        | Sucesso                                                                                               |
| --------------------- | ------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `POST /lots/:id/bids` | BIDDER  | cabeçalho `Idempotency-Key` (8 a 128 caracteres) + `{ amountCents }` (inteiro) | 201 `{ bid, lot, wallet }`; mesma chave e mesmo valor de novo → 200 com o mesmo `bid`, sem lance novo |
| `GET /lots/:id/bids`  | público | —                                                                              | 200 `{ items: [{ seq, amountCents, pseudonym, createdAt }] }`, do mais novo para o mais antigo        |

`bid` = `{ seq, lotId, amountCents, pseudonym, createdAt }`; `lot` no formato acima; `wallet` no formato do `GET /wallet`. O licitante aparece só pelo pseudônimo (`"Licitante 7F3A9C"`), estável dentro do lote e diferente entre lotes: nenhuma resposta pública traz id, nome, e-mail, hash ou selo.

Recusas (RF-70), todas com mensagem em português:

| Status | Código                   | Quando                                                                     |
| ------ | ------------------------ | -------------------------------------------------------------------------- |
| 422    | `BID_BELOW_MINIMUM`      | abaixo do lance inicial ou do atual + incremento; `details.minAmountCents` |
| 422    | `INSUFFICIENT_FUNDS`     | acima do disponível; `details.availableCents`                              |
| 409    | `ALREADY_WINNING`        | quem já lidera tenta cobrir o próprio lance                                |
| 409    | `LOT_NOT_STARTED`        | antes do início                                                            |
| 409    | `LOT_ENDED`              | a partir do fim (o lance no instante exato do fim é recusado)              |
| 409    | `LOT_CANCELED`           | lote cancelado                                                             |
| 409    | `IDEMPOTENCY_KEY_REUSED` | a chave já foi usada em outro lance (outro valor ou outro lote)            |
| 403    | `FORBIDDEN`              | leiloeiro (nunca dá lance)                                                 |
| 401    | `UNAUTHORIZED`           | sem token                                                                  |
| 404    | `LOT_NOT_FOUND`          | lote inexistente                                                           |
| 400    | `VALIDATION_ERROR`       | sem `Idempotency-Key`, valor não inteiro ou ≤ 0                            |

**Como o lance é gravado.** Uma transação só: trava a linha do lote (`SELECT … FOR UPDATE`) e a linha do licitante (`FOR NO KEY UPDATE`, a carteira dele), lê a hora do servidor, valida, grava o lance, o `COMMIT` do novo líder e o `RELEASE` do antigo, e atualiza no lote o lance atual, o líder, a cabeça da cadeia e o fim (anti-sniping). Lances do mesmo lote passam um de cada vez; o segundo é revalidado contra o lance que o primeiro gravou. Lances do mesmo licitante em lotes diferentes também passam um de cada vez, então o disponível nunca fica negativo.

**Cadeia de hash.** Cada lance guarda `seq` (1..n no lote), `prev_hash`, `hash` e `seal`:

- `hash = SHA-256(JSON.stringify(["v1", lotId, seq, pseudonym, amountCents, createdAtMs, prevHash]))`; no lance 1, `prevHash = SHA-256("genesis:" + lotId)`;
- `seal = HMAC-SHA256(SEAL_SECRET, "bid:v1" + hash)`;
- o lote guarda a cabeça: `head_seq`, `head_hash` e `head_seal = HMAC-SHA256(SEAL_SECRET, "head:v1" + lotId + seq + hash)`;
- `pseudonym = "Licitante " + 6 primeiros hexadecimais (maiúsculos) de HMAC-SHA256(PSEUDONYM_SECRET, "pseudonym:v1" + lotId + bidderId)`.

Qualquer pessoa recalcula a cadeia de hashes a partir do histórico público; só o selo exige o servidor. Trocar o licitante de um lance no banco muda o pseudônimo e quebra o hash. Limite: quem tiver o banco **e** o `SEAL_SECRET`, ou um backup antigo com uma cabeça anterior, ainda forja o histórico; só uma âncora externa resolveria. Trocar `SEAL_SECRET` invalida os selos gravados; trocar `PSEUDONYM_SECRET` muda os pseudônimos e quebra os hashes gravados.

**Anti-sniping (RN-10).** Lance aceito com 120 000 ms ou menos até o fim muda o fim para `max(endsAt, instante do lance + 2 min)`, na mesma transação do lance, com o lote travado. O fim nunca diminui e não há limite de prorrogações; `originalEndsAt` guarda o fim marcado na criação. Lance no instante exato do fim é recusado (`LOT_ENDED`).

## Tempo real (SSE)

`GET /lots/:id/events` (público) é um stream [Server-Sent Events](https://developer.mozilla.org/docs/Web/API/Server-sent_events): ao conectar chega `event: snapshot`; depois `event: bid` (lance aceito, já com o `endsAt` prorrogado), `event: canceled` e `event: settled`. O `data` de todo evento é `{ "serverTime": ISO, "lot": lot }`, o mesmo `lot` do `GET /lots/:id`, sem dado de quem assiste (o `EventSource` não manda autenticação). Um comentário `: ping` a cada 15 s mantém a conexão viva. Lote inexistente: 404 `LOT_NOT_FOUND` em JSON. Cabeçalhos: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`, CORS igual ao resto da API.

- **Como publica:** o caso de uso chama a porta `LotEventsPublisher.publish(lotId, type)` (`src/application/lot-events-publisher.ts`) **depois do COMMIT**; o barramento em memória (`src/infra/events/`) relê o lote do banco uma vez e entrega o mesmo evento a todos os inscritos. Ao fechar a conexão, o listener sai.
- **Uma instância:** o barramento vive no processo, por isso o Cloud Run roda com `--max-instances=1` (produção e staging, no `cd.yml`). Mais instâncias exigem outro barramento (`LISTEN/NOTIFY` ou pub/sub).
- **Plano B:** se o stream cair, o `EventSource` reconecta sozinho e o web volta à recarga periódica do `GET /lots/:id` a cada 3 s enquanto o stream estiver fora. O `--timeout=3600` do Cloud Run fecha o stream após 60 min; a reconexão traz um `snapshot` novo.

## Liquidação e comprovante

**Liquidação (RN-11).** Lote vencido (fim ≤ agora, não cancelado) é liquidado uma vez só, numa transação com a linha do lote travada (a mesma trava do lance e do cancelamento):

- **com lances:** o vencedor (o líder) recebe `RELEASE` + `DEBIT` do valor final, o leiloeiro recebe `CREDIT` do mesmo valor, o lote fica `result = SOLD` e nasce o comprovante. Perdedores não recebem nada: o valor deles já foi liberado quando foram superados;
- **sem lances:** `result = NO_WINNER`, sem movimento nem comprovante.

Disparo: um agendador de 5 s no processo (`server.ts`, desligado nos testes) liquida até 20 lotes vencidos por rodada, e `GET /lots/:id`, `GET /lots/:id/audit`, `GET /lots`, `GET /auctioneer/lots` e `GET /me/bids` liquidam na leitura os lotes vencidos que mostram (cobre o staging que dorme com `min-instances=0`). Disparo duplo é seguro: quem chega depois lê `settled_at` e não grava nada; o índice único do comprovante (`lot_id`) e um índice parcial único de `DEBIT`/`CREDIT` por lote seguram até um disparo que escape da trava. Lote liquidado não aceita lance nem cancelamento (`LOT_ENDED`).

**Comprovante (`GET /receipts/:publicId`, público).** `receipt` = `{ publicId, lotId, title, imageUrl: "/lots/:id/image", finalAmountCents, settledAt, winnerPseudonym, finalHash, auditPath: "/lots/:lotId/audit" }`. O `publicId` tem 16 bytes aleatórios em base64url. O banco guarda `public_id`, `lot_id`, `winner_pseudonym`, `amount_cents`, `settled_at`, `bid_count`, `final_hash` e `seal = HMAC-SHA256(SEAL_SECRET, "receipt:v1" + todos esses campos)`; título, imagem e link da auditoria derivam do lote. Selo que não confere ou cabeça do lote diferente de `bid_count`/`final_hash` → 404, igual a inexistente. Não chama a API de itens e não tem nome, e-mail nem id de usuário.

## Auditoria

`GET /lots/:id/audit` (público; um JWT, se vier, é ignorado) → `{ lot, bids: [{ seq, pseudonym, amountCents, createdAt, prevHash, hash }], verdict: "INTACT" | "TAMPERED", firstInconsistency: null | { seq, reason }, checkedAt }`. Vale para lote ao vivo, encerrado, liquidado e cancelado; lote vencido é liquidado na leitura, como no `GET /lots/:id`. `lot` é o mesmo do `GET /lots/:id` com `viewer: null`; `bids` vêm em ordem de `seq`, como estão no banco (mesmo adulterados), só com o pseudônimo, sem id, nome, e-mail nem selo. Lote inexistente ou id inválido → 404 `LOT_NOT_FOUND`.

**O que é conferido**, nesta ordem, parando na primeira inconsistência:

1. **Cadeia** (do lance 1 ao n): numeração sem buracos (`GAP`), hash recalculado igual ao guardado (`CONTENT_CHANGED`), selo do lance (`BAD_SEAL`) e `prev_hash` igual ao hash do anterior (`BROKEN_LINK`). `seq` aponta o primeiro lance inconsistente.
2. **Cabeça do lote:** `head_seq`, `head_hash` e `head_seal` batem com o último lance (`HEAD_MISMATCH`, `seq: null`). Pega o último lance apagado.
3. **Comprovante:** lote `SOLD` tem de ter um e lote não arrematado não pode ter; o selo `receipt:v1` confere e `lot_id`, `bid_count`, `final_hash`, `winner_pseudonym` e `amount_cents` são os do lote e do último lance (`RECEIPT_MISMATCH`, `seq: null`).
4. **Liquidação × lances × extrato** (`SETTLEMENT_MISMATCH`, `seq: null`): `settled_at` e `result` andam juntos; lote liquidado com lances é sempre `SOLD` e `SOLD` exige lances (trocar o resultado para `NO_WINNER` e apagar comprovante e extrato não passa); lote `SOLD` tem um `DEBIT` só, do licitante do último lance e no valor dele, e um `CREDIT` só, do leiloeiro, no mesmo valor; lote não arrematado não tem `DEBIT` nem `CREDIT`.
5. **Estorno do cancelamento** (`CANCEL_MISMATCH`, `seq: null`): lote cancelado com lances tem um `REFUND` só, do licitante do último lance e no valor dele; qualquer outro lote não tem `REFUND`.
6. **Lance atual e líder:** `current_bid_cents` e `leader_id` do lote são o valor e o licitante do último lance; sem lances, os dois são `null` (`HEAD_MISMATCH`, `seq: null`: são gravados na mesma transação da cabeça e fazem parte dela).

| Motivo                | O que pegou                                                      | `seq`                     |
| --------------------- | ---------------------------------------------------------------- | ------------------------- |
| `GAP`                 | numeração com buraco (lance apagado no meio)                     | primeiro número que falta |
| `CONTENT_CHANGED`     | hash recalculado diferente do guardado (valor, hora, licitante)  | lance adulterado          |
| `BAD_SEAL`            | selo do lance não confere                                        | lance adulterado          |
| `BROKEN_LINK`         | `prev_hash` diferente do hash do lance anterior                  | lance adulterado          |
| `HEAD_MISMATCH`       | cabeça selada, lance atual ou líder diferentes do último lance   | `null`                    |
| `RECEIPT_MISMATCH`    | comprovante ausente, sobrando ou com campo/selo errado           | `null`                    |
| `SETTLEMENT_MISMATCH` | resultado, `DEBIT` ou `CREDIT` incoerentes com os lances         | `null`                    |
| `CANCEL_MISMATCH`     | `REFUND` ausente, duplicado ou fora de lote cancelado com lances | `null`                    |

**Recalculada a cada acesso (RF-61).** Nada do veredito é guardado: lote, lances, comprovante, `DEBIT`, `CREDIT` e `REFUND` são lidos numa transação `REPEATABLE READ` (um lance que entra no meio não parece adulteração da cabeça) e conferidos de novo; a resposta vai com `Cache-Control: no-store`. A lógica é pura (`src/domain/integrity/lot-audit.ts`), testada sem banco, e o T-06 (`test/e2e/audit.test.ts`) adultera o banco por SQL direto (íntegro, valor editado, lance apagado no meio, lance inserido, último lance apagado, selo trocado, ligação quebrada, lance atual e líder adulterados), com o lote ao vivo e depois da liquidação, mais comprovante, `DEBIT` e `CREDIT` adulterados e resultado trocado para `NO_WINNER`.

**Limite.** Quem tem o banco **e** o `SEAL_SECRET`, ou um backup antigo com uma cabeça anterior, ainda forja um histórico que passa; só uma âncora externa resolveria. Também passa como `INTACT`, sem o segredo, apagar **todos** os lances de um lote ainda não liquidado e zerar a cabeça (`head_seq = 0`, `head_hash` e `head_seal` nulos) junto com lance atual e líder: uma cadeia vazia é íntegra por definição. Um `REVOKE UPDATE, DELETE ON bids` para o usuário da aplicação seria uma camada extra opcional; não está aplicado.

## Meus lances (licitante)

`GET /me/bids` (só `BIDDER`) → `{ serverTime, items: [{ lot, myMaxBidCents, position, receiptPublicId }] }`: os lotes em que o licitante deu lance, do lance mais recente dele ao mais antigo. `position` é `LEADING` ou `OUTBID` (ao vivo), `WON` ou `LOST` (encerrado) e `CANCELED`; `receiptPublicId` só em `WON`.

## API externa de itens (Art Institute of Chicago)

Só a busca do painel (`GET /items/search`), a miniatura da busca (`GET /items/images/:imageId/thumbnail`) e a criação do lote chamam a API. Ao criar o lote, título, atributos e **a imagem** são copiados para o PostgreSQL; vitrine, detalhe e imagem nunca chamam a API, então seguem de pé se ela cair.

- Sem chave. Cada chamada leva `AIC-User-Agent: stonebid (https://github.com/FranciscoYlderlan/stonebid-api)`, como a [documentação](https://api.artic.edu/docs/) pede.
- Limite da AIC: 60 requisições por minuto por IP (anônimo). A busca guarda resultados por 5 minutos em memória.
- Dados em CC0. Só entram obras com imagem e em domínio público (`is_public_domain`), como a AIC recomenda para uso de imagens.
- Imagem pelo IIIF, no tamanho padrão de 843 px: `{iiif_url}/{image_id}/full/843,/0/default.jpg`.
- Falha de rede, timeout (`ITEMS_API_TIMEOUT_MS`, 5 s), 5xx ou resposta inválida → 502 `EXTERNAL_API_UNAVAILABLE` com mensagem em português, e nada é gravado. Não há nova tentativa automática: o painel mostra o erro e o leiloeiro tenta de novo.
- A imagem do lote tem teto de `LOT_IMAGE_MAX_BYTES` (2 MB): maior que isso → 422 `ITEM_IMAGE_TOO_LARGE`, e o lote não é criado.
- Miniaturas da busca: cache em memória por instância (até 300 imagens, 32 MB, 24 h; só sucesso entra) e limite de 120 requisições por minuto por IP (429 `TOO_MANY_REQUESTS`, com `retry-after`).
- Se o banco falhar ao montar a situação das obras (`auction`), a busca responde assim mesmo, com `auction: null`; a criação do lote confere de novo, com a obra travada.
- Testado com a AIC fora do ar (T-07) e lenta (timeout), por um servidor que imita a AIC.

## Camada MCP

Com `MCP_ENABLED=true`, a API expõe um servidor MCP (Streamable HTTP, sessão por `mcp-session-id`) em `/mcp`. Toda requisição exige `MCP_API_KEY` em `x-api-key` ou `Authorization: Bearer` (comparação em tempo constante); sem ela ou errada, 401 `UNAUTHORIZED`. Ligada em local e staging (`MCP_ENABLED=true` no `cd.yml` e no Compose); em produção está desligada e a rota `/mcp` não existe (404).

```bash
# local (Compose: chave padrão local-mcp-api-key-change-me, ou a do seu .env)
claude mcp add --transport http stonebid http://localhost:3333/mcp --header "x-api-key: <chave>"
# staging (a chave fica no Secret Manager, MCP_API_KEY_STAGING)
claude mcp add --transport http stonebid-staging https://stonebid-api-staging-7idhzkkvpq-rj.a.run.app/mcp --header "x-api-key: <chave>"
```

| Tool               | Rota                      | Observação                                                                          |
| ------------------ | ------------------------- | ----------------------------------------------------------------------------------- |
| `entrar`           | `POST /auth/login`        | `user`: `leiloeiro` \| `licitante-1` \| `licitante-2`. Guarda o token na sessão MCP |
| `health`           | `GET /health`             |                                                                                     |
| `auth_me`          | `GET /auth/me`            | Usa a sessão de `entrar`                                                            |
| `auth_register`    | `POST /auth/register`     |                                                                                     |
| `auth_login`       | `POST /auth/login`        | Só devolve a resposta; não troca a sessão                                           |
| `items_search`     | `GET /items/search`       | Leiloeiro                                                                           |
| `lots_create`      | `POST /lots`              | Leiloeiro                                                                           |
| `lots_list`        | `GET /lots`               |                                                                                     |
| `lots_get`         | `GET /lots/:id`           |                                                                                     |
| `lots_audit`       | `GET /lots/:id/audit`     | `{ lotId }`; público, mesmo corpo da rota                                           |
| `auctioneer_lots`  | `GET /auctioneer/lots`    | Leiloeiro; traz `totalReceivedCents`                                                |
| `lots_cancel`      | `POST /lots/:id/cancel`   | `{ id, reason }`; leiloeiro dono                                                    |
| `receipts_get`     | `GET /receipts/:publicId` | `{ publicId }`; público                                                             |
| `wallet_get`       | `GET /wallet`             | Licitante (sessão de `entrar`)                                                      |
| `wallet_deposit`   | `POST /wallet/deposits`   | `{ amountCents, idempotencyKey }`; a chave vai no cabeçalho `Idempotency-Key`       |
| `wallet_movements` | `GET /wallet/movements`   | Licitante (sessão de `entrar`)                                                      |
| `bids_place`       | `POST /lots/:id/bids`     | `{ id, amountCents, idempotencyKey }`; licitante (sessão de `entrar`)               |
| `bids_list`        | `GET /lots/:id/bids`      | `{ id }`; público                                                                   |
| `bids_mine`        | `GET /me/bids`            | Licitante (sessão de `entrar`)                                                      |

As tools chamam as rotas reais com `app.inject()` (validação, auth e erros de verdade). Cada rota nova ganha a sua tool em `src/infra/mcp/tools/`. O token de `entrar` vive só na sessão MCP, em memória.

## Privacidade

- **Pseudônimo por lote:** em toda resposta pública o licitante é `"Licitante " + 6 hexadecimais` de `HMAC-SHA256(PSEUDONYM_SECRET, "pseudonym:v1" + lotId + bidderId)`. É estável dentro do lote e muda de um lote para outro, então não dá para seguir um licitante entre lotes. Sem o segredo, não se volta do pseudônimo ao usuário.
- **O que nunca sai em rota pública** (lote, lances, SSE, auditoria, comprovante): id, nome e e-mail de usuário, hash de senha, selo e dados do leiloeiro. A auditoria mostra `prevHash` e `hash`, que só servem para recalcular a cadeia. Coberto pelo T-09.
- **Pseudônimo próprio:** o licitante logado vê o seu em `viewer.pseudonym` no `GET /lots/:id`, para se reconhecer no histórico.
- Senhas com bcrypt; o segredo do pseudônimo é separado do segredo dos selos.

## CI/CD

```
branch tipo/ID-descricao → PR para main → CI verde → merge humano na main → CD publica a produção
→ staging avança até a main (só o ponteiro) → CD publica o staging
```

- **Produção primeiro:** todo código entra pela `main`, por PR com CI verde e merge do humano. O `cd.yml` publica a produção (API no Cloud Run; o `stonebid-web` publica na Vercel pelo próprio `cd.yml`).
- **Staging depois, sempre igual à `main`:** a branch `staging` só avança o ponteiro até a `main` (`git push origin origin/main:refs/heads/staging`), sem merge nem commit próprio. O CI roda nesse push e o `cd.yml` publica o staging: API `stonebid-api-staging`, com MCP ligada e banco separado, e web no alias `stonebid-web-staging.vercel.app`.
- **Nenhum deploy fora do `cd.yml`:** a integração Git da Vercel está desligada, e nada é publicado à mão.

- **CI** (`.github/workflows/ci.yml`, em todo push e PR): `npm ci`, lint, Prettier, typecheck, `prisma migrate deploy` e `npm test` num PostgreSQL 18 de serviço, e `npm run build`.
- **CD** (`.github/workflows/cd.yml`): roda quando o CI de um **push** em `main` ou `staging` termina verde. Builda a imagem Docker, envia ao Artifact Registry, roda migração + seed num Cloud Run Job e publica no Cloud Run (`stonebid-api` na `main`, `stonebid-api-staging` na `staging`). Autenticação no GCP por Workload Identity Federation, sem chave de conta de serviço; segredos no Secret Manager.
- **Diferenças:** produção com 1 instância sempre ligada e MCP desligada; staging com 0 instâncias mínimas (dorme sem uso) e MCP ligada. Os dois com `--max-instances=1` (ver [Tempo real](#tempo-real-sse)).
- Configuração do GCP e da Vercel do zero: [`infra/deploy-guide.md`](infra/deploy-guide.md) e `infra/gcp-setup.sh`.

## Características de funcionamento e limites

Escolhas de projeto da API, cada uma com o motivo. Onde há um limite, ele está dito junto com o que o resolveria.

- **Resultado logo depois do fim.** O `status` vem do relógio do servidor, então o lote passa a `ENDED` no instante do fim; o `result` chega com a liquidação, um passo à parte, feito numa transação com o lote travado. Ela roda no agendador a cada 5 s e em toda leitura que mostra o lote (`GET /lots`, `GET /lots/:id`, auditoria, `GET /auctioneer/lots`, `GET /me/bids`), o que cobre o staging: ele dorme sem uso, e o agendador só roda enquanto houver requisição. `GET /lots/:id/bids` só lista os lances e não liquida.
- **Fim exato e anti-sniping sem teto.** O fim é o primeiro instante de `ENDED`, então um lance nesse instante recebe `LOT_ENDED`. A prorrogação segue a RN-10, sem limite: enquanto houver lance nos últimos 2 minutos, o lote continua. `originalEndsAt` guarda o fim marcado na criação.
- **Quem lidera espera ser coberto** (`ALREADY_WINNING`). Faz parte das regras do lance (RN-02 a RN-05): o próximo lance vem de outro licitante.
- **Cancelamento com lances estorna o líder.** Com o OPC-2 ligado (produção e staging), o lote com lances pode ser cancelado até o fim, e o líder recebe um `REFUND` do lance atual na mesma transação; os superados já tinham o valor liberado. Assim nenhum saldo fica preso num lote cancelado. O `REFUND` libera o comprometido em vez de somar ao total, porque o dinheiro nunca saiu da carteira; somar criaria dinheiro. Como o `canceledAt` não tem selo, a auditoria confere o estorno contra os lances (`CANCEL_MISMATCH`).
- **Teto por depósito.** `DEPOSIT_LIMIT_CENTS` vale para cada depósito (Q-10); vários depósitos somam, sem teto de saldo. O saldo é simulado e não há saque.
- **Cadeia vazia conta como `INTACT`.** A auditoria confere os lances que existem, e uma cadeia sem lances é íntegra por definição. Por isso apagar todos os lances de um lote ainda não liquidado e zerar a cabeça, o lance atual e o líder passa na auditoria; quem tem o banco e o `SEAL_SECRET`, ou um backup antigo, também forja um histórico que passa. Uma âncora externa fecharia essas brechas, e um `REVOKE UPDATE, DELETE ON bids` seria uma camada extra (ver [Auditoria](#auditoria)).
- **Comprovante só quando confere.** `GET /receipts/:publicId` só devolve comprovante com selo válido e igual à cabeça do lote; adulterado responde 404, como inexistente. O veredito, com o motivo, fica na auditoria do lote (`auditPath`).
- **Segredos amarram o histórico.** Os selos são HMAC com `SEAL_SECRET`, e o pseudônimo, gerado com `PSEUDONYM_SECRET`, entra no hash do lance. Por isso um novo `SEAL_SECRET` faz todo lote com lances dar `TAMPERED`, e um novo `PSEUDONYM_SECRET` muda os pseudônimos e quebra os hashes gravados.
- **Pseudônimo de 6 hexadecimais** (24 bits). Dois licitantes no mesmo lote podem ter o mesmo pseudônimo, com chance de cerca de 1 em 16 milhões.
- **Uma instância só.** O tempo real usa um barramento em memória, por isso o Cloud Run roda com `--max-instances=1` (ver [Tempo real](#tempo-real-sse)). O limite de requisições, os caches da AIC e as sessões MCP também vivem na memória do processo: um reinício derruba as sessões MCP (o cliente recebe 400 `MCP_SESSION_REQUIRED` e faz um `initialize` novo) e esvazia os caches. Mais instâncias pediriam outro barramento (`LISTEN/NOTIFY` ou pub/sub).
- **Cache da busca.** Resultados da AIC ficam 5 min em memória, o que poupa o limite de 60 requisições por minuto da AIC. Ao chegar a 200 buscas guardadas, o cache é esvaziado inteiro, o que mantém a memória limitada.
- **A obra é copiada na criação do lote.** Título, atributos e imagem vão para o PostgreSQL, então vitrine, detalhe, imagem e comprovante seguem de pé com a AIC fora do ar (T-07). Mudanças posteriores na AIC não chegam ao lote.
- **Vitrine de encerrados com os 30 de fim mais recente.** Cancelados ficam fora da vitrine e aparecem no painel do leiloeiro e por link direto.
- **Cadastro com papel escolhido.** `POST /auth/register` aceita `AUCTIONEER` ou `BIDDER` de quem pedir. Login e cadastro não limitam tentativas.
- **JWT sem revogação.** O token é autocontido e o servidor não guarda sessão: ele vale 7 dias, e sair é apagar o token no cliente, sem logout no servidor.
- **Seed em todo deploy.** O Cloud Run Job roda migração e seed a cada deploy, e o seed é reexecutável: os três usuários de teste voltam sempre com nome, papel e a senha de `SEED_PASSWORD`. As datas dos lotes do seed só são calculadas na primeira criação, para que rodar de novo não as mude; por isso o lote ao vivo do seed encerra 14 dias depois da primeira execução e, a partir daí, não recebe lances novos.

## Estrutura

```
src/
├── domain/              # entidades, interfaces de repositório e do catálogo de itens, erros de negócio
├── application/         # use-cases/ e portas da aplicação (ex.: LotEventsPublisher)
├── infra/
│   ├── http/            # controllers, routes, middlewares, schemas, errors
│   ├── events/          # barramento em memória do tempo real (SSE)
│   ├── mcp/             # plugin /mcp, sessão, tools
│   ├── external/        # adaptador da API de itens (Art Institute of Chicago)
│   ├── repositories/    # Prisma (cliente gerado em repositories/prisma/generated/, fora do git)
│   └── factories/
├── env/                 # único lugar que lê process.env
├── types/
├── app.ts
└── server.ts
prisma/                  # schema, migrations, seed e imagens do seed (seed-assets/)
infra/                   # guia de deploy e script do GCP
test/
├── unit/                # regras puras (lance, anti-sniping, auditoria, cadeia, caches)
└── e2e/                 # rotas com banco real e AIC simulada
```

## Uso de IA

Como usei IA neste projeto (orquestração de subagentes, memória no Obsidian e quem definiu, aplicou e refinou cada parte): [docs/uso-de-ia.md](https://github.com/FranciscoYlderlan/stonebid-web/blob/main/docs/uso-de-ia.md), no repositório `stonebid-web`.
