/** Atributos de uma obra, copiados da API de itens para o lote (RN-13). */
export interface ItemAttributes {
  artist: string | null;
  date: string | null;
  medium: string | null;
  dimensions: string | null;
  placeOfOrigin: string | null;
}

/** Item da API pública de itens (AD-06), como o painel do leiloeiro mostra na busca (RF-20). */
export interface CatalogItem {
  externalId: string;
  title: string;
  /** Id da imagem na API externa; a miniatura da busca sai por `GET /items/images/:imageId/thumbnail`. */
  imageId: string;
  /** URL da imagem na API externa, só para o servidor copiar na criação do lote (RN-13). */
  imageUrl: string;
  attributes: ItemAttributes;
}

export interface ItemImage {
  data: Uint8Array;
  contentType: string;
}
