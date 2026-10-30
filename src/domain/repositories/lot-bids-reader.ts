/**
 * Porta para saber se um lote já tem lances (RN-12). Os lances chegam no I2:
 * até lá a implementação responde sempre `false`.
 */
export interface LotBidsReader {
  hasBids(lotId: string): Promise<boolean>;
}
