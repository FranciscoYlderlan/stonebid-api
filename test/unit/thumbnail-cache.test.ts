import { describe, expect, it, vi } from 'vitest';
import type { ItemImage } from '../../src/domain/entities/item.ts';
import { ThumbnailCache } from '../../src/infra/external/thumbnail-cache.ts';

const image = (bytes: number): ItemImage => ({
  data: new Uint8Array(bytes),
  contentType: 'image/jpeg',
});

function makeCache(overrides: Partial<{ maxEntries: number; maxBytes: number; ttlMs: number }>) {
  let now = 0;
  const cache = new ThumbnailCache({
    maxEntries: 10,
    maxBytes: 1_000,
    ttlMs: 1_000,
    now: () => now,
    ...overrides,
  });
  return { cache, advance: (ms: number) => (now += ms) };
}

describe('ThumbnailCache', () => {
  it('guarda o sucesso: a segunda leitura não chama o loader', async () => {
    const { cache } = makeCache({});
    const load = vi.fn(async () => image(10));
    const first = await cache.get('a', load);
    const second = await cache.get('a', load);
    expect(second).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('pedidos simultâneos dividem uma só busca', async () => {
    const { cache } = makeCache({});
    let resolve!: (value: ItemImage) => void;
    const load = vi.fn(() => new Promise<ItemImage>((r) => (resolve = r)));
    const pending = [cache.get('a', load), cache.get('a', load), cache.get('a', load)];
    resolve(image(10));
    const results = await Promise.all(pending);
    expect(load).toHaveBeenCalledTimes(1);
    expect(new Set(results).size).toBe(1);
  });

  it('falha e null não ficam no cache', async () => {
    const { cache } = makeCache({});
    await expect(cache.get('a', () => Promise.reject(new Error('caiu')))).rejects.toThrow('caiu');
    expect(await cache.get('b', async () => null)).toBeNull();
    expect(cache.size).toBe(0);

    const load = vi.fn(async () => image(10));
    await cache.get('a', load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('LRU por quantidade: despeja o usado há mais tempo', async () => {
    const { cache } = makeCache({ maxEntries: 2 });
    await cache.get('a', async () => image(1));
    await cache.get('b', async () => image(1));
    await cache.get('a', async () => image(1)); // "a" vira o mais recente
    await cache.get('c', async () => image(1)); // despeja "b"

    const load = vi.fn(async () => image(1));
    await cache.get('a', load);
    await cache.get('c', load);
    expect(load).not.toHaveBeenCalled();
    await cache.get('b', load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(2);
  });

  it('LRU por bytes: o total nunca passa do teto; item maior que o teto não entra', async () => {
    const { cache } = makeCache({ maxBytes: 100 });
    await cache.get('a', async () => image(40));
    await cache.get('b', async () => image(40));
    await cache.get('c', async () => image(40)); // 120 > 100: despeja "a"
    expect(cache.bytes).toBe(80);
    expect(cache.size).toBe(2);

    await cache.get('grande', async () => image(101));
    expect(cache.size).toBe(2);
    expect(cache.bytes).toBe(80);
  });

  it('validade: depois do TTL busca de novo', async () => {
    const { cache, advance } = makeCache({ ttlMs: 1_000 });
    const load = vi.fn(async () => image(10));
    await cache.get('a', load);
    advance(999);
    await cache.get('a', load);
    expect(load).toHaveBeenCalledTimes(1);
    advance(2);
    await cache.get('a', load);
    expect(load).toHaveBeenCalledTimes(2);
    expect(cache.bytes).toBe(10);
  });
});
