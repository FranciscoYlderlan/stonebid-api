/** Mudança de um lote que a sala ao vivo recebe por SSE (AD-04). */
export type LotEventType = 'bid' | 'canceled' | 'settled';

/**
 * Porta do tempo real (AD-04): o caso de uso avisa, **depois do COMMIT**, que o lote mudou. Quem
 * implementa relê o lote do banco e entrega aos inscritos. `publish` não espera a entrega nem
 * lança erro: a resposta da requisição não depende do stream.
 */
export interface LotEventsPublisher {
  publish(lotId: string, type: LotEventType): void;
}

/** Sem tempo real (testes de caso de uso que não olham o stream). */
export const noLotEvents: LotEventsPublisher = { publish: () => undefined };
