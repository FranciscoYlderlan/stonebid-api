import { AuthenticateUserUseCase } from '../../application/use-cases/authenticate-user.ts';
import { PrismaUsersRepository } from '../repositories/prisma/prisma-users-repository.ts';

export function makeAuthenticateUserUseCase(): AuthenticateUserUseCase {
  return new AuthenticateUserUseCase(new PrismaUsersRepository());
}
