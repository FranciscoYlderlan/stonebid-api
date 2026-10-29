import { GetUserProfileUseCase } from '../../application/use-cases/get-user-profile.ts';
import { PrismaUsersRepository } from '../repositories/prisma/prisma-users-repository.ts';

export function makeGetUserProfileUseCase(): GetUserProfileUseCase {
  return new GetUserProfileUseCase(new PrismaUsersRepository());
}
