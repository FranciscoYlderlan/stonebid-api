import type { ItemCatalog, ItemSearchPage } from '../../domain/catalog/item-catalog.ts';
import type { CatalogItem, ItemAttributes, ItemImage } from '../../domain/entities/item.ts';
import { ExternalApiUnavailableError } from '../../domain/errors/external-api-unavailable-error.ts';
import { ItemImageTooLargeError } from '../../domain/errors/item-image-too-large-error.ts';

/**
 * Adaptador da API pública do Art Institute of Chicago (AD-06), sem chave.
 * Documentação: https://api.artic.edu/docs/
 * - Anônimo: até 60 requisições/minuto por IP. A busca guarda resultados por alguns minutos.
 * - Dados em CC0; imagens só de obras em domínio público (`is_public_domain`), como a AIC recomenda.
 * - Imagem pelo IIIF: `{iiif_url}/{image_id}/full/843,/0/default.jpg` (843 px é o tamanho em cache).
 */
export interface ArticItemCatalogOptions {
  apiBaseUrl: string;
  /** Usado se a resposta não trouxer `config.iiif_url`. */
  iiifBaseUrl: string;
  timeoutMs: number;
  /** Itens por página na busca. */
  pageSize?: number;
  /** Validade do cache da busca, em ms (0 desliga). */
  searchCacheTtlMs?: number;
}

/** Cabeçalho de cortesia pedido pela AIC (o navegador não deixa trocar o User-Agent). */
export const AIC_USER_AGENT = 'stonebid (https://github.com/FranciscoYlderlan/stonebid-api)';

const FIELDS = [
  'id',
  'title',
  'image_id',
  'is_public_domain',
  'artist_display',
  'date_display',
  'medium_display',
  'dimensions',
  'place_of_origin',
].join(',');

/** A AIC não devolve mais que 10.000 resultados por busca. */
const MAX_RESULTS = 10_000;
const SEARCH_CACHE_MAX_ENTRIES = 200;

interface ArticArtwork {
  id: number;
  title?: string | null;
  image_id?: string | null;
  is_public_domain?: boolean | null;
  artist_display?: string | null;
  date_display?: string | null;
  medium_display?: string | null;
  dimensions?: string | null;
  place_of_origin?: string | null;
}

interface ArticConfig {
  iiif_url?: string;
}

export class ArticItemCatalog implements ItemCatalog {
  private readonly pageSize: number;
  private readonly cacheTtlMs: number;
  private readonly searchCache = new Map<string, { expiresAt: number; value: ItemSearchPage }>();

  constructor(private readonly options: ArticItemCatalogOptions) {
    this.pageSize = options.pageSize ?? 12;
    this.cacheTtlMs = options.searchCacheTtlMs ?? 5 * 60 * 1000;
  }

  async search(query: string, page: number): Promise<ItemSearchPage> {
    const cacheKey = `${query.toLowerCase()}|${page}`;
    const cached = this.searchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const params = new URLSearchParams({
      page: String(page),
      limit: String(this.pageSize),
      fields: FIELDS,
      'query[term][is_public_domain]': 'true',
    });
    if (query) params.set('q', query);

    const body = await this.getJson<{
      data?: ArticArtwork[];
      pagination?: { total_pages?: number; total?: number };
      config?: ArticConfig;
    }>(`/artworks/search?${params.toString()}`);

    if (!body || !Array.isArray(body.data)) throw new ExternalApiUnavailableError(invalidResponse);

    const iiifBase = body.config?.iiif_url ?? this.options.iiifBaseUrl;
    const items = body.data
      .map((artwork) => toCatalogItem(artwork, iiifBase))
      .filter((item): item is CatalogItem => item !== null);

    const reachablePages = Math.ceil(MAX_RESULTS / this.pageSize);
    const totalPages = Math.min(body.pagination?.total_pages ?? page, reachablePages);
    const value: ItemSearchPage = { items, page, totalPages };

    if (this.cacheTtlMs > 0) {
      if (this.searchCache.size >= SEARCH_CACHE_MAX_ENTRIES) this.searchCache.clear();
      this.searchCache.set(cacheKey, { expiresAt: Date.now() + this.cacheTtlMs, value });
    }
    return value;
  }

  async findById(externalId: string): Promise<CatalogItem | null> {
    if (!/^\d{1,12}$/.test(externalId)) return null;

    const body = await this.getJson<{ data?: ArticArtwork; config?: ArticConfig }>(
      `/artworks/${externalId}?fields=${FIELDS}`,
    );
    if (body === null) return null;
    if (!body.data) throw new ExternalApiUnavailableError(invalidResponse);

    return toCatalogItem(body.data, body.config?.iiif_url ?? this.options.iiifBaseUrl);
  }

  async downloadImage(imageUrl: string, maxBytes: number): Promise<ItemImage> {
    const response = await this.request(imageUrl, 'image/*');
    if (!response.ok) {
      throw new ExternalApiUnavailableError(
        'Não foi possível baixar a imagem do item na API de itens. Tente de novo em instantes.',
      );
    }

    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    if (!contentType.startsWith('image/')) {
      throw new ExternalApiUnavailableError('A API de itens devolveu uma imagem inválida.');
    }

    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel();
      throw new ItemImageTooLargeError(maxBytes);
    }

    const data = await readLimited(response, maxBytes);
    if (data.byteLength === 0) {
      throw new ExternalApiUnavailableError('A API de itens devolveu uma imagem vazia.');
    }
    return { data, contentType };
  }

  /** GET JSON na API; 404 → null; rede, timeout, 5xx ou JSON inválido → ExternalApiUnavailableError. */
  private async getJson<T>(path: string): Promise<T | null> {
    const response = await this.request(`${this.options.apiBaseUrl}${path}`, 'application/json');
    if (response.status === 404) return null;
    if (!response.ok) throw new ExternalApiUnavailableError();
    try {
      return (await response.json()) as T;
    } catch {
      throw new ExternalApiUnavailableError(invalidResponse);
    }
  }

  private async request(url: string, accept: string): Promise<Response> {
    try {
      return await fetch(url, {
        headers: { accept, 'AIC-User-Agent': AIC_USER_AGENT },
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new ExternalApiUnavailableError(
        timedOut
          ? `A API de itens (Art Institute of Chicago) não respondeu em ${this.options.timeoutMs / 1000} s. Tente de novo em instantes.`
          : undefined,
      );
    }
  }
}

const invalidResponse =
  'A API de itens devolveu uma resposta inválida. Tente de novo em instantes.';

function toCatalogItem(artwork: ArticArtwork, iiifBase: string): CatalogItem | null {
  if (!artwork.image_id || artwork.is_public_domain === false) return null;
  const attributes: ItemAttributes = {
    artist: clean(artwork.artist_display),
    date: clean(artwork.date_display),
    medium: clean(artwork.medium_display),
    dimensions: clean(artwork.dimensions),
    placeOfOrigin: clean(artwork.place_of_origin),
  };
  return {
    externalId: String(artwork.id),
    title: clean(artwork.title) ?? 'Sem título',
    imageUrl: `${iiifBase.replace(/\/+$/, '')}/${encodeURIComponent(artwork.image_id)}/full/843,/0/default.jpg`,
    attributes,
  };
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Lê o corpo até `maxBytes`; passou disso → ItemImageTooLargeError. */
async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ItemImageTooLargeError(maxBytes);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ItemImageTooLargeError) throw error;
    throw new ExternalApiUnavailableError(
      'A conexão com a API de itens caiu ao baixar a imagem. Tente de novo em instantes.',
    );
  }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}
