-- I3: liquidação (RN-11, AD-08), comprovante (RF-51, M-12) e motivo do cancelamento.

-- CreateEnum
CREATE TYPE "LotResult" AS ENUM ('SOLD', 'NO_WINNER');

-- AlterTable
ALTER TABLE "lots" ADD COLUMN "cancel_reason" TEXT,
ADD COLUMN "settled_at" TIMESTAMPTZ(3),
ADD COLUMN "result" "LotResult";

-- Manual (CHECK): hora e resultado da liquidação andam juntos; lote vendido tem líder; cancelado
-- não liquida; motivo só em lote cancelado.
ALTER TABLE "lots" ADD CONSTRAINT "lots_settlement_consistent" CHECK (("settled_at" IS NULL) = ("result" IS NULL));
ALTER TABLE "lots" ADD CONSTRAINT "lots_sold_has_leader" CHECK ("result" IS DISTINCT FROM 'SOLD' OR "leader_id" IS NOT NULL);
ALTER TABLE "lots" ADD CONSTRAINT "lots_canceled_not_settled" CHECK ("canceled_at" IS NULL OR "settled_at" IS NULL);
ALTER TABLE "lots" ADD CONSTRAINT "lots_cancel_reason_only_canceled" CHECK ("cancel_reason" IS NULL OR "canceled_at" IS NOT NULL);

-- CreateTable
CREATE TABLE "receipts" (
    "id" UUID NOT NULL,
    "public_id" TEXT NOT NULL,
    "lot_id" UUID NOT NULL,
    "winner_pseudonym" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "settled_at" TIMESTAMPTZ(3) NOT NULL,
    "bid_count" INTEGER NOT NULL,
    "final_hash" TEXT NOT NULL,
    "seal" TEXT NOT NULL,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "receipts_public_id_key" ON "receipts"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_lot_id_key" ON "receipts"("lot_id");

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Manual (CHECK): valor > 0 e pelo menos um lance.
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_amount_cents_positive" CHECK ("amount_cents" > 0);
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_bid_count_positive" CHECK ("bid_count" >= 1);

-- Manual (índice parcial): a liquidação grava um DEBIT (vencedor) e um CREDIT (leiloeiro) por
-- lote, uma vez só, nem com disparo duplo.
CREATE UNIQUE INDEX "wallet_movements_settlement_once" ON "wallet_movements"("lot_id", "type") WHERE "type" IN ('DEBIT', 'CREDIT') AND "lot_id" IS NOT NULL;
