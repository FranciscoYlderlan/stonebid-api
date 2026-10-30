-- CreateEnum
CREATE TYPE "WalletMovementType" AS ENUM ('DEPOSIT', 'COMMIT', 'RELEASE', 'DEBIT', 'CREDIT', 'REFUND');

-- CreateTable
CREATE TABLE "wallet_movements" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "WalletMovementType" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "lot_id" UUID,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wallet_movements_user_id_created_at_idx" ON "wallet_movements"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_movements_user_id_idempotency_key_key" ON "wallet_movements"("user_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "wallet_movements" ADD CONSTRAINT "wallet_movements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Manual (o schema do Prisma não expressa CHECK): valor sempre positivo, o sinal vem do tipo (RN-16).
ALTER TABLE "wallet_movements" ADD CONSTRAINT "wallet_movements_amount_cents_positive" CHECK ("amount_cents" > 0);
