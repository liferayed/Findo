const { ValidationError, ConflictError, NotFoundError } = require('../src/errors');

describe('error types', () => {
  test('ValidationError carries a 400 status and the list of validation errors', () => {
    const err = new ValidationError(['nickname is required']);
    expect(err.statusCode).toBe(400);
    expect(err.errors).toEqual(['nickname is required']);
  });

  test('ConflictError carries a 409 status and a message', () => {
    const err = new ConflictError('nickname already in use');
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe('nickname already in use');
  });

  test('NotFoundError carries a 404 status and a message', () => {
    const err = new NotFoundError('account not found');
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('account not found');
  });
});
