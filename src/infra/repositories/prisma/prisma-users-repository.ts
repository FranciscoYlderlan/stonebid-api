import type { User } from '../../../domain/entities/user.ts';
import { EmailTakenError } from '../../../domain/errors/email-taken-error.ts';
import type {
  CreateUserInput,
  UsersRepository,
} from '../../../domain/repositories/users-repository.ts';
import { Prisma } from './generated/client.ts';
import { prisma } from './prisma-client.ts';

export class PrismaUsersRepository implements UsersRepository {
  async findById(id: string): Promise<User | null> {
    // Token com `sub` que não é UUID não chega ao banco (evita erro de tipo no Postgres).
    if (!isUuid(id)) return null;
    return prisma.user.findUnique({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email } });
  }

  async create(data: CreateUserInput): Promise<User> {
    try {
      return await prisma.user.create({ data });
    } catch (error) {
      // Corrida entre dois cadastros com o mesmo e-mail: o índice único decide.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new EmailTakenError();
      }
      throw error;
    }
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}
