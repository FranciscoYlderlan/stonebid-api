import { readFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ArticItemCatalog } from '../../src/infra/external/artic-item-catalog.ts';

/** Imagem servida pelo IIIF simulado (a mesma do seed-2). */
export const MOCK_IMAGE = readFileSync(
  new URL('../../prisma/seed-assets/seed-2.png', import.meta.url),
);

/** Ids de imagem no formato da AIC (UUID). */
export const IMG_900001 = '0a000000-0000-4000-8000-000000900001';
export const IMG_900003 = '0a000000-0000-4000-8000-000000900003';
export const IMG_BIG = '0a000000-0000-4000-8000-00000000b16b';

export const mockArtworks = [
  {
    id: 900001,
    title: 'Paisagem simulada',
    image_id: IMG_900001,
    is_public_domain: true,
    artist_display: 'Pintora Teste\nBrasil, 1850–1920',
    date_display: '1890',
    medium_display: 'Óleo sobre tela',
    dimensions: '50 × 70 cm',
    place_of_origin: 'Brasil',
  },
  { id: 900002, title: 'Obra sem imagem', image_id: null, is_public_domain: true },
  {
    id: 900003,
    title: 'Retrato simulado',
    image_id: IMG_900003,
    is_public_domain: true,
    artist_display: null,
    date_display: 'c. 1700',
    medium_display: null,
    dimensions: null,
    place_of_origin: 'Itália',
  },
  { id: 900004, title: 'Imagem grande', image_id: IMG_BIG, is_public_domain: true },
];

/**
 * Obras extras (RN-19): uma obra só tem um lote vivo, então cada teste usa ids próprios.
 * Ids de 910000 a 919999 existem no simulador, com os dados do 900001 (mesma imagem).
 */
export const GENERIC_ID_MIN = 910_000;
export const GENERIC_ID_MAX = 919_999;

function genericArtwork(id: number) {
  return { ...mockArtworks[0]!, id };
}

let nextGenericId = GENERIC_ID_MIN;
/** Id de obra que nenhum outro teste usa (dentro da mesma execução). */
export function uniqueExternalId(): string {
  return String(nextGenericId++);
}

/** Busca que devolve exatamente estas obras genéricas: `q=ids:910001,910002`. */
export function searchByIds(ids: readonly string[]): string {
  return `ids:${ids.join(',')}`;
}

export type MockMode = 'ok' | 'down' | 'slow';

export interface ItemsApiMock {
  catalog: ArticItemCatalog;
  /** Requisições recebidas (caminho e cabeçalhos), para provar quem chama a API. */
  requests: { url: string; headers: IncomingHttpHeaders }[];
  setMode(mode: MockMode): void;
  close(): Promise<void>;
}

/**
 * Servidor que imita a API do Art Institute of Chicago e o IIIF, para testar o adaptador
 * real (ArticItemCatalog) sem rede: busca, item por id, imagem, queda e lentidão.
 */
export async function startItemsApiMock(timeoutMs = 300): Promise<ItemsApiMock> {
  let mode: MockMode = 'ok';
  const requests: ItemsApiMock['requests'] = [];
  let baseUrl = '';
  const sockets = new Set<import('node:net').Socket>();

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://mock');
    requests.push({ url: url.pathname + url.search, headers: req.headers });

    if (mode === 'slow') return; // nunca responde: o adaptador estoura o timeout
    if (mode === 'down') {
      res.writeHead(503, { 'content-type': 'text/plain' }).end('fora do ar');
      return;
    }

    const config = { iiif_url: `${baseUrl}/iiif/2` };
    const json = (status: number, body: unknown) =>
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));

    if (url.pathname === '/api/v1/artworks/search') {
      const ids = url.searchParams.get('q')?.match(/^ids:([\d,]+)$/);
      if (ids) {
        const data = (ids[1] ?? '').split(',').map((id) => genericArtwork(Number(id)));
        return json(200, {
          pagination: { total: data.length, total_pages: 1, current_page: 1 },
          data,
          config,
        });
      }
      return json(200, {
        pagination: { total: mockArtworks.length, total_pages: 1, current_page: 1 },
        data: mockArtworks,
        config,
      });
    }

    const artwork = url.pathname.match(/^\/api\/v1\/artworks\/(\d+)$/);
    if (artwork) {
      const id = Number(artwork[1]);
      const found =
        id >= GENERIC_ID_MIN && id <= GENERIC_ID_MAX
          ? genericArtwork(id)
          : mockArtworks.find((item) => item.id === id);
      return found
        ? json(200, { data: found, config })
        : json(404, { status: 404, error: 'Not found' });
    }

    if (url.pathname === `/iiif/2/${IMG_BIG}/full/843,/0/default.jpg`) {
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      return res.end(Buffer.alloc(64 * 1024, 1));
    }
    const iiif = url.pathname.match(
      /^\/iiif\/2\/([0-9a-f-]{36})\/full\/(843|400),\/0\/default\.jpg$/,
    );
    if (iiif && [IMG_900001, IMG_900003, IMG_BIG].includes(iiif[1] ?? '')) {
      return res.writeHead(200, { 'content-type': 'image/png' }).end(MOCK_IMAGE);
    }

    json(404, { status: 404, error: 'Not found' });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  const catalog = new ArticItemCatalog({
    apiBaseUrl: `${baseUrl}/api/v1`,
    iiifBaseUrl: `${baseUrl}/iiif/2`,
    timeoutMs,
    searchCacheTtlMs: 0,
  });

  return {
    catalog,
    requests,
    setMode: (next) => {
      mode = next;
    },
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
