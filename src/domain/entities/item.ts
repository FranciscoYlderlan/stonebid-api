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
  /** URL da imagem na API externa. Só a busca do painel usa; o lote guarda a cópia (RN-13). */
  imageUrl: string;
  attributes: ItemAttributes;
}

export interface ItemImage {
  data: Uint8Array;
  contentType: string;
}
