/**
 * Porta para saber se um lote já tem lances (RN-12, RN-19). Os lances chegam no I2:
 * até lá a implementação responde que nenhum lote tem lance.
 */
export interface LotBidsReader {
  hasBids(lotId: string): Promise<boolean>;
  /** Dentre `lotIds`, os que têm pelo menos um lance (uma consulta só). */
  listLotIdsWithBids(lotIds: readonly string[]): Promise<Set<string>>;
}
