import type { User } from '../../domain/entities/user.ts';
import { InvalidCredentialsError } from '../../domain/errors/invalid-credentials-error.ts';
import type { UsersRepository } from '../../domain/repositories/users-repository.ts';
import { verifyPassword } from '../password-hashing.ts';

export interface AuthenticateUserInput {
  email: string;
  password: string;
}

export class AuthenticateUserUseCase {
  constructor(private readonly usersRepository: UsersRepository) {}

  async execute(input: AuthenticateUserInput): Promise<{ user: User }> {
    const user = await this.usersRepository.findByEmail(input.email.trim().toLowerCase());
    if (!user) throw new InvalidCredentialsError();

    const matches = await verifyPassword(input.password, user.passwordHash);
    if (!matches) throw new InvalidCredentialsError();

    return { user };
  }
}
