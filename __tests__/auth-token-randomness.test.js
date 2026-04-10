const jwt = require('jsonwebtoken');

describe('auth token randomness', () => {
  test('setAuth issues unique tokens for the same user', async () => {
    let setAuth;
    let loginUser;

    jest.isolateModules(() => {
      loginUser = jest.fn(async () => {});

      jest.doMock('../src/database/database.js', () => ({
        Role: {
          Diner: 'diner',
          Franchisee: 'franchisee',
          Admin: 'admin',
        },
        DB: {
          loginUser,
        },
      }));

      ({ setAuth } = require('../src/routes/authRouter.js'));
    });

    const user = { id: 1, name: 'admin', email: 'a@jwt.com', roles: [{ role: 'admin' }] };

    const tokenA = await setAuth(user);
    const tokenB = await setAuth(user);

    expect(tokenA).not.toBe(tokenB);
    expect(loginUser).toHaveBeenCalledTimes(2);

    const payloadA = jwt.decode(tokenA);
    const payloadB = jwt.decode(tokenB);

    expect(payloadA.jti).toEqual(expect.any(String));
    expect(payloadB.jti).toEqual(expect.any(String));
    expect(payloadA.jti).not.toBe(payloadB.jti);
  });
});
