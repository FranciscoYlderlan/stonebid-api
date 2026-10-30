import { EventEmitter } from 'node:events';
import type { LotEventsPublisher, LotEventType } from '../../application/lot-events-publisher.ts';

/** Evento entregue a quem assiste ao lote: tipo e `data` já serializado (o mesmo para todos). */
export interface LotEventMessage {
  type: LotEventType;
  data: string;
}

export type LotEventListener = (message: LotEventMessage) => void;

/** Lê o lote de novo e devolve o `data` do evento; `null` se o lote sumiu. */
export type LotEventLoader = (lotId: string) => Promise<string | null>;

/**
 * Barramento em memória do tempo real (AD-04): vale para uma instância só (`--max-instances=1` no
 * Cloud Run). Cada `publish` relê o lote uma vez e entrega o mesmo `data` a todos os inscritos.
 * As releituras de um lote passam em fila, para o último evento nunca trazer um estado mais velho
 * que o anterior. Lote sem inscritos não lê o banco.
 */
export class InMemoryLotEventsBus implements LotEventsPublisher {
  private readonly emitter = new EventEmitter();
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly load: LotEventLoader,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {
    // Cada conexão SSE é um listener; o teto padrão (10) só serve para achar vazamento.
    this.emitter.setMaxListeners(0);
  }

  publish(lotId: string, type: LotEventType): void {
    if (this.listenerCount(lotId) === 0) return;

    const previous = this.queues.get(lotId) ?? Promise.resolve();
    const next = previous
      .then(async () => {
        if (this.listenerCount(lotId) === 0) return;
        const data = await this.load(lotId);
        if (data !== null) this.emitter.emit(lotId, { type, data } satisfies LotEventMessage);
      })
      .catch(this.onError)
      .finally(() => {
        if (this.queues.get(lotId) === next) this.queues.delete(lotId);
      });
    this.queues.set(lotId, next);
  }

  /** `data` do estado atual (o snapshot de quem acaba de conectar); `null` se o lote não existe. */
  snapshot(lotId: string): Promise<string | null> {
    return this.load(lotId);
  }

  /** Inscreve no lote; devolve a função que remove o listener (chamada ao fechar a conexão). */
  subscribe(lotId: string, listener: LotEventListener): () => void {
    this.emitter.on(lotId, listener);
    return () => {
      this.emitter.off(lotId, listener);
    };
  }

  listenerCount(lotId: string): number {
    return this.emitter.listenerCount(lotId);
  }
}
