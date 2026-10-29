import { RegisterUserUseCase } from '../../application/use-cases/register-user.ts';
import { PrismaUsersRepository } from '../repositories/prisma/prisma-users-repository.ts';

export function makeRegisterUserUseCase(): RegisterUserUseCase {
  return new RegisterUserUseCase(new PrismaUsersRepository());
}
