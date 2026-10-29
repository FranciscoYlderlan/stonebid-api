import { z } from 'zod';
import { roles } from '../../../domain/entities/user.ts';

/** Schemas das rotas de auth. A camada MCP reaproveita os mesmos (sem regra duplicada). */
export const registerBodySchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome.').max(120),
  email: z.email('Informe um e-mail válido.').max(254),
  password: z.string().min(8, 'A senha precisa de pelo menos 8 caracteres.').max(128),
  role: z.enum(roles, 'O papel deve ser AUCTIONEER ou BIDDER.'),
});

export const loginBodySchema = z.object({
  email: z.email('Informe um e-mail válido.'),
  password: z.string().min(1, 'Informe a senha.'),
});

export type RegisterBody = z.infer<typeof registerBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
