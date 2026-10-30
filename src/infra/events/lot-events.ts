import { toLotEventData } from '../http/presenters/lot-event-presenter.ts';
import { PrismaLotsRepository } from '../repositories/prisma/prisma-lots-repository.ts';
import { InMemoryLotEventsBus } from './in-memory-lot-events-bus.ts';

const lotsRepository = new PrismaLotsRepository();

/**
 * O barramento do processo (uma instância por processo, AD-04). Relê o lote do banco depois do
 * COMMIT de quem publicou e monta o `data` com a hora do servidor dessa leitura.
 */
export const lotEventsBus = new InMemoryLotEventsBus(
  async (lotId) => {
    const lot = await lotsRepository.findById(lotId);
    return lot ? toLotEventData(lot, new Date()) : null;
  },
  (error) => console.error('Falha ao publicar evento do lote:', error),
);
