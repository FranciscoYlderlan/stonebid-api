-- Pseudônimo com 6 dígitos (decisão de 2026-10-30): o pseudônimo entra no hash do lance, então os
-- lances gravados com o código de 4 dígitos deixariam de ser verificáveis. Com o aval do humano
-- (2026-10-30), os lances de teste recomeçam: o seed (idempotente) recria os do lote ao vivo.
-- Não apaga usuários, lotes nem depósitos.

-- Movimentos ligados a lance (COMMIT do líder e RELEASE do superado).
DELETE FROM "wallet_movements" WHERE "type" IN ('COMMIT', 'RELEASE') AND "lot_id" IS NOT NULL;

DELETE FROM "bids";

-- Cabeça dos lotes zerada: sem lance atual, líder nem cadeia.
UPDATE "lots"
SET "current_bid_cents" = NULL,
    "leader_id" = NULL,
    "head_seq" = 0,
    "head_hash" = NULL,
    "head_seal" = NULL;
