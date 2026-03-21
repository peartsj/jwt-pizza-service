const request = require('supertest');
const { buildApp, signToken } = require('../test/testAppFactory');

describe('user functions', () => {
  function authHeader(user = { id: 1, name: 'admin', email: 'a@jwt.com', roles: [{ role: 'admin' }] }) {
    return `Bearer ${signToken(user)}`;
  }

  function buildAuthedApp(dbOverrides = {}) {
    return buildApp({
      dbOverrides: {
        isLoggedIn: jest.fn(async () => true),
        ...dbOverrides,
      },
    });
  }

  test('list users unauthorized', async () => {
    const app = buildApp();
    const listUsersRes = await request(app).get('/api/user');
    expect(listUsersRes.status).toBe(401);
  });

  test('list users returns a user list payload', async () => {
    const users = [{ id: 2, name: 'pizza diner', email: 'diner@jwt.com', roles: [{ role: 'diner' }] }];
    const getUsers = jest.fn(async () => [users, false]);
    const app = buildAuthedApp({ getUsers });

    const listUsersRes = await request(app)
      .get('/api/user')
      .set('Authorization', authHeader());

    expect(listUsersRes.status).toBe(200);
    expect(getUsers).toHaveBeenCalledWith(1, 10, '*');
    expect(listUsersRes.body).toEqual({ users, page: 1, limit: 10, more: false });
  });

  test('list users passes pagination and name filter params', async () => {
    const users = [{ id: 3, name: 'alice', email: 'alice@jwt.com', roles: [{ role: 'diner' }] }];
    const getUsers = jest.fn(async () => [users, true]);
    const app = buildAuthedApp({ getUsers });

    const listUsersRes = await request(app)
      .get('/api/user?page=2&limit=1&name=ali*')
      .set('Authorization', authHeader());

    expect(listUsersRes.status).toBe(200);
    expect(getUsers).toHaveBeenCalledWith(2, 1, 'ali*');
    expect(listUsersRes.body).toEqual({ users, page: 2, limit: 1, more: true });
  });
});