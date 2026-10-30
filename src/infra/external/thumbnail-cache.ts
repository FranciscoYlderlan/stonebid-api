import type { ItemImage } from '../../domain/entities/item.ts';

export interface ThumbnailCacheOptions {
  /** Quantas miniaturas no máximo. */
  maxEntries: number;
  /** Soma máxima dos bytes guardados. */
  maxBytes: number;
  /** Validade de cada miniatura, em ms. */
  ttlMs: number;
  /** Relógio (os testes trocam). */
  now?: () => number;
}

interface Entry {
  value: ItemImage;
  expiresAt: number;
}

/**
 * Cache em memória das miniaturas, por id de imagem: LRU limitado por quantidade e por bytes,
 * com validade. Pedidos simultâneos do mesmo id dividem uma só busca. Só sucesso entra no
 * cache: falha (exceção) e "não existe" (`null`) não ficam guardados.
 */
export class ThumbnailCache {
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<ItemImage | null>>();
  private totalBytes = 0;
  private readonly now: () => number;

  constructor(private readonly options: ThumbnailCacheOptions) {
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  get bytes(): number {
    return this.totalBytes;
  }

  async get(key: string, load: () => Promise<ItemImage | null>): Promise<ItemImage | null> {
    const hit = this.entries.get(key);
    if (hit) {
      this.remove(key, hit);
      if (hit.expiresAt > this.now()) {
        this.entries.set(key, hit); // volta para o fim: usado por último
        this.totalBytes += hit.value.data.byteLength;
        return hit.value;
      }
    }

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const promise = load()
      .then((value) => {
        if (value) this.store(key, value);
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  private store(key: string, value: ItemImage): void {
    const size = value.data.byteLength;
    if (size > this.options.maxBytes || this.options.maxEntries <= 0) return;

    const old = this.entries.get(key);
    if (old) this.remove(key, old);
    this.entries.set(key, { value, expiresAt: this.now() + this.options.ttlMs });
    this.totalBytes += size;

    // Map guarda a ordem de inserção: o primeiro é o usado há mais tempo.
    while (this.entries.size > this.options.maxEntries || this.totalBytes > this.options.maxBytes) {
      const oldest = this.entries.entries().next().value;
      if (!oldest) break;
      this.remove(oldest[0], oldest[1]);
    }
  }

  private remove(key: string, entry: Entry): void {
    this.entries.delete(key);
    this.totalBytes -= entry.value.data.byteLength;
  }
}
