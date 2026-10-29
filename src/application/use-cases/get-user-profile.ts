import type { User } from '../../domain/entities/user.ts';
import { UnauthorizedError } from '../../domain/errors/unauthorized-error.ts';
import type { UsersRepository } from '../../domain/repositories/users-repository.ts';

export class GetUserProfileUseCase {
  constructor(private readonly usersRepository: UsersRepository) {}

  async execute(userId: string): Promise<{ user: User }> {
    const user = await this.usersRepository.findById(userId);
    // Token válido de um usuário que não existe mais: trata como sessão inválida.
    if (!user) throw new UnauthorizedError();
    return { user };
  }
}
