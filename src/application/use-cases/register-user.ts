import type { Role, User } from '../../domain/entities/user.ts';
import { EmailTakenError } from '../../domain/errors/email-taken-error.ts';
import type { UsersRepository } from '../../domain/repositories/users-repository.ts';
import { hashPassword } from '../password-hashing.ts';

export interface RegisterUserInput {
  name: string;
  email: string;
  password: string;
  role: Role;
}

export class RegisterUserUseCase {
  constructor(private readonly usersRepository: UsersRepository) {}

  async execute(input: RegisterUserInput): Promise<{ user: User }> {
    const email = input.email.trim().toLowerCase();

    const existing = await this.usersRepository.findByEmail(email);
    if (existing) throw new EmailTakenError();

    const passwordHash = await hashPassword(input.password);
    const user = await this.usersRepository.create({
      name: input.name.trim(),
      email,
      passwordHash,
      role: input.role,
    });

    return { user };
  }
}
