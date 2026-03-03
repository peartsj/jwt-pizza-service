const { asyncHandler, StatusCodeError } = require('../src/endpointHelper.js');

describe('endpointHelper', () => {
  test('StatusCodeError carries statusCode', () => {
    const err = new StatusCodeError('nope', 403);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('nope');
    expect(err.statusCode).toBe(403);
  });

  test('asyncHandler forwards thrown errors to next()', async () => {
    const boom = new Error('boom');
    const handler = asyncHandler(async () => {
      throw boom;
    });

    const next = jest.fn();
    await handler({}, {}, next);
    expect(next).toHaveBeenCalledWith(boom);
  });
});
