/**
 * Erro de regra de negócio. O `code` é estável (contrato com o frontend);
 * a camada HTTP traduz o código para o status da resposta.
 */
export abstract class AppError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
