-- I2: lances (RN-02 a RN-09, RN-14), cabeça da cadeia no lote (M-12) e ordem do extrato.

-- Lote: lance atual, líder e cabeça da cadeia de hash.
ALTER TABLE "lots" ADD COLUMN "current_bid_cents" INTEGER,
ADD COLUMN "leader_id" UUID,
ADD COLUMN "head_seq" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "head_hash" TEXT,
ADD COLUMN "head_seal" TEXT;

ALTER TABLE "lots" ADD CONSTRAINT "lots_leader_id_fkey" FOREIGN KEY ("leader_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Manual (CHECK): lance atual e líder andam juntos; cabeça vazia só sem lances.
ALTER TABLE "lots" ADD CONSTRAINT "lots_current_bid_and_leader" CHECK (("current_bid_cents" IS NULL) = ("leader_id" IS NULL));
ALTER TABLE "lots" ADD CONSTRAINT "lots_head_consistent" CHECK (
  ("head_seq" = 0 AND "head_hash" IS NULL AND "head_seal" IS NULL)
  OR ("head_seq" > 0 AND "head_hash" IS NOT NULL AND "head_seal" IS NOT NULL)
);

-- CreateTable
CREATE TABLE "bids" (
    "id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "bidder_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "prev_hash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "seal" TEXT NOT NULL,

    CONSTRAINT "bids_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bids_lot_id_seq_key" ON "bids"("lot_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "bids_bidder_id_idempotency_key_key" ON "bids"("bidder_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_bidder_id_fkey" FOREIGN KEY ("bidder_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Manual (CHECK): valor em centavos > 0 (RN-16) e numeração a partir de 1.
ALTER TABLE "bids" ADD CONSTRAINT "bids_amount_cents_positive" CHECK ("amount_cents" > 0);
ALTER TABLE "bids" ADD CONSTRAINT "bids_seq_positive" CHECK ("seq" >= 1);

-- Extrato: sequência global crescente. Os movimentos já gravados recebem a ordem de criação
-- (backfill); os novos, o próximo valor da sequência (equivale ao SERIAL do autoincrement()).
ALTER TABLE "wallet_movements" ADD COLUMN "seq" INTEGER;

UPDATE "wallet_movements" AS m
SET "seq" = o."n"
FROM (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "created_at", "id") AS "n" FROM "wallet_movements"
) AS o
WHERE m."id" = o."id";

CREATE SEQUENCE "wallet_movements_seq_seq" AS INTEGER OWNED BY "wallet_movements"."seq";
SELECT setval('"wallet_movements_seq_seq"', COALESCE((SELECT MAX("seq") FROM "wallet_movements"), 0) + 1, false);
ALTER TABLE "wallet_movements" ALTER COLUMN "seq" SET DEFAULT nextval('"wallet_movements_seq_seq"');
ALTER TABLE "wallet_movements" ALTER COLUMN "seq" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "wallet_movements_seq_key" ON "wallet_movements"("seq");

-- CreateIndex
CREATE INDEX "wallet_movements_lot_id_idx" ON "wallet_movements"("lot_id");

-- AddForeignKey
ALTER TABLE "wallet_movements" ADD CONSTRAINT "wallet_movements_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
