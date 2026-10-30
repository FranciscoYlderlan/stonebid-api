-- RN-19: lotes da obra (checagem na criação e situação da obra na busca).
-- CreateIndex
CREATE INDEX "lots_external_id_idx" ON "lots"("external_id");
