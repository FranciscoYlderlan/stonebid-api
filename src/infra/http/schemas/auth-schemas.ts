import { z } from 'zod';
import { roles } from '../../../domain/entities/user.ts';

/** Schemas das rotas de auth. A camada MCP reaproveita os mesmos (sem regra duplicada). */
export const registerBodySchema = z.object(
  {
    name: z
      .string('Informe o nome.')
      .trim()
      .min(1, 'Informe o nome.')
      .max(120, 'O nome deve ter no máximo 120 caracteres.'),
    email: z
      .email('Informe um e-mail válido.')
      .max(254, 'O e-mail deve ter no máximo 254 caracteres.'),
    password: z
      .string('Informe a senha.')
      .min(8, 'A senha precisa de pelo menos 8 caracteres.')
      .max(128, 'A senha deve ter no máximo 128 caracteres.'),
    role: z.enum(roles, 'O papel deve ser AUCTIONEER ou BIDDER.'),
  },
  'Envie os dados do cadastro no corpo da requisição, em JSON.',
);

export const loginBodySchema = z.object(
  {
    email: z.email('Informe um e-mail válido.'),
    password: z.string('Informe a senha.').min(1, 'Informe a senha.'),
  },
  'Envie o e-mail e a senha no corpo da requisição, em JSON.',
);

export type RegisterBody = z.infer<typeof registerBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
