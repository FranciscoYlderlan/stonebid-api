/**
 * Porta para saber se um lote já tem lances (RN-19: lote encerrado com lances prende a obra).
 * O cancelamento (RN-12) não usa esta porta: ele lê a cabeça do lote com o lote travado.
 */
export interface LotBidsReader {
  hasBids(lotId: string): Promise<boolean>;
  /** Dentre `lotIds`, os que têm pelo menos um lance (uma consulta só). */
  listLotIdsWithBids(lotIds: readonly string[]): Promise<Set<string>>;
}
