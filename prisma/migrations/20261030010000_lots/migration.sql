-- CreateTable
CREATE TABLE "lots" (
    "id" UUID NOT NULL,
    "auctioneer_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "attributes" JSONB NOT NULL,
    "image_data" BYTEA NOT NULL,
    "image_content_type" TEXT NOT NULL,
    "starting_bid_cents" INTEGER NOT NULL,
    "min_increment_cents" INTEGER NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "original_ends_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "canceled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lots_auctioneer_id_idx" ON "lots"("auctioneer_id");

-- CreateIndex
CREATE INDEX "lots_ends_at_idx" ON "lots"("ends_at");

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_auctioneer_id_fkey" FOREIGN KEY ("auctioneer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
