/**
 * Seed reexecutável (RNF-02), sem rede: cria ou atualiza com upsert os usuários de teste,
 * dá aos licitantes um depósito inicial com chave de idempotência fixa (não duplica ao rodar
 * de novo) e cria três lotes do leiloeiro (ao vivo, agendado e encerrado), com imagens de
 * prisma/seed-assets/.
 */
import { readFile } from 'node:fs/promises';
import { hashPassword } from '../src/application/password-hashing.ts';
import type { ItemAttributes } from '../src/domain/entities/item.ts';
import type { Role } from '../src/domain/entities/user.ts';
import { env } from '../src/env/index.ts';
import { prisma } from '../src/infra/repositories/prisma/prisma-client.ts';

const seedUsers: { name: string; email: string; role: Role }[] = [
  { name: 'Leiloeiro', email: 'leiloeiro@stonebid.dev', role: 'AUCTIONEER' },
  { name: 'Licitante 1', email: 'licitante-1@stonebid.dev', role: 'BIDDER' },
  { name: 'Licitante 2', email: 'licitante-2@stonebid.dev', role: 'BIDDER' },
];

/** Depósito inicial dos licitantes: R$ 5.000,00. */
const SEED_DEPOSIT_CENTS = 500_000;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

interface SeedLot {
  /** Chave estável do upsert. */
  id: string;
  externalId: string;
  title: string;
  attributes: ItemAttributes;
  image: string;
  startingBidCents: number;
  minIncrementCents: number;
  /** Datas relativas ao momento em que o lote é criado pela primeira vez. */
  startsInMs: number;
  durationMs: number;
}

const seedLots: SeedLot[] = [
  {
    id: '5eed0000-0000-4000-8000-000000000001',
    externalId: 'seed-1',
    title: 'Entardecer sobre as colinas',
    attributes: {
      artist: 'Artista desconhecido (Escola paisagista)',
      date: 'c. 1890',
      medium: 'Óleo sobre tela',
      dimensions: '60 × 80 cm',
      placeOfOrigin: 'França',
    },
    image: 'seed-1.png',
    startingBidCents: 50_000,
    minIncrementCents: 5_000,
    // AO_VIVO: começou há 1 hora e termina em 14 dias.
    startsInMs: -HOUR,
    durationMs: 14 * DAY + HOUR,
  },
  {
    id: '5eed0000-0000-4000-8000-000000000002',
    externalId: 'seed-2',
    title: 'Composição em vermelho, amarelo e azul',
    attributes: {
      artist: 'Ateliê geométrico',
      date: '1930',
      medium: 'Óleo sobre tela',
      dimensions: '46 × 46 cm',
      placeOfOrigin: 'Países Baixos',
    },
    image: 'seed-2.png',
    startingBidCents: 120_000,
    minIncrementCents: 10_000,
    // AGENDADO: começa em 1 dia e dura 2 dias.
    startsInMs: DAY,
    durationMs: 2 * DAY,
  },
  {
    id: '5eed0000-0000-4000-8000-000000000003',
    externalId: 'seed-3',
    title: 'Natureza-morta com vaso azul',
    attributes: {
      artist: 'Mestre de natureza-morta',
      date: 'Século XVII',
      medium: 'Óleo sobre madeira',
      dimensions: '38 × 52 cm',
      placeOfOrigin: 'Espanha',
    },
    image: 'seed-3.png',
    startingBidCents: 30_000,
    minIncrementCents: 2_500,
    // ENCERRADO: começou há 2 dias e terminou há 1 dia.
    startsInMs: -2 * DAY,
    durationMs: DAY,
  },
];

async function main(): Promise<void> {
  if (!env.SEED_PASSWORD) throw new Error('Defina SEED_PASSWORD para rodar o seed.');
  const passwordHash = await hashPassword(env.SEED_PASSWORD);

  for (const user of seedUsers) {
    await prisma.user.upsert({
      where: { email: user.email },
      create: { ...user, passwordHash },
      update: { name: user.name, role: user.role, passwordHash },
    });
    console.log(`seed: ${user.email} (${user.role})`);
  }

  for (const user of seedUsers.filter((u) => u.role === 'BIDDER')) {
    const { id: userId } = await prisma.user.findUniqueOrThrow({ where: { email: user.email } });
    // ON CONFLICT DO NOTHING no índice (user_id, idempotency_key): o extrato nunca é alterado.
    const { count } = await prisma.walletMovement.createMany({
      data: {
        userId,
        type: 'DEPOSIT',
        amountCents: SEED_DEPOSIT_CENTS,
        idempotencyKey: `seed-deposit-${user.email}`,
      },
      skipDuplicates: true,
    });
    console.log(`seed: depósito inicial de ${user.email} (${count ? 'criado' : 'já existia'})`);
  }

  const auctioneer = await prisma.user.findUniqueOrThrow({
    where: { email: 'leiloeiro@stonebid.dev' },
  });
  const now = Date.now();

  for (const lot of seedLots) {
    const imageData = new Uint8Array(
      await readFile(new URL(`./seed-assets/${lot.image}`, import.meta.url)),
    );
    const item = {
      auctioneerId: auctioneer.id,
      externalId: lot.externalId,
      title: lot.title,
      attributes: { ...lot.attributes },
      imageData,
      imageContentType: 'image/png',
      startingBidCents: lot.startingBidCents,
      minIncrementCents: lot.minIncrementCents,
    };
    const startsAt = new Date(now + lot.startsInMs);
    const endsAt = new Date(now + lot.startsInMs + lot.durationMs);

    // As datas só são calculadas na primeira criação; rodar de novo não mexe nelas.
    await prisma.lot.upsert({
      where: { id: lot.id },
      create: { id: lot.id, ...item, startsAt, originalEndsAt: endsAt, endsAt },
      update: item,
    });
    console.log(`seed: lote ${lot.externalId} (${lot.title})`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
