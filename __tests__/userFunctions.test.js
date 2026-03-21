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

  test('delete user unauthorized', async () => {
    const app = buildApp();
    const deleteUserRes = await request(app).delete('/api/user/2');
    expect(deleteUserRes.status).toBe(401);
  });

  test('delete user forbids deleting another user when not admin', async () => {
    const deleteUser = jest.fn(async () => {});
    const app = buildAuthedApp({ deleteUser });
    const dinerHeader = authHeader({ id: 7, name: 'diner', email: 'd@jwt.com', roles: [{ role: 'diner' }] });

    const deleteUserRes = await request(app)
      .delete('/api/user/8')
      .set('Authorization', dinerHeader);

    expect(deleteUserRes.status).toBe(403);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  test('delete user allows deleting self', async () => {
    const deleteUser = jest.fn(async () => {});
    const app = buildAuthedApp({ deleteUser });
    const dinerHeader = authHeader({ id: 7, name: 'diner', email: 'd@jwt.com', roles: [{ role: 'diner' }] });

    const deleteUserRes = await request(app)
      .delete('/api/user/7')
      .set('Authorization', dinerHeader);

    expect(deleteUserRes.status).toBe(200);
    expect(deleteUser).toHaveBeenCalledWith(7);
    expect(deleteUserRes.body.message).toMatch(/deleted/i);
  });

  test('delete user allows admin to delete another user', async () => {
    const deleteUser = jest.fn(async () => {});
    const app = buildAuthedApp({ deleteUser });

    const deleteUserRes = await request(app)
      .delete('/api/user/42')
      .set('Authorization', authHeader());

    expect(deleteUserRes.status).toBe(200);
    expect(deleteUser).toHaveBeenCalledWith(42);
    expect(deleteUserRes.body.message).toMatch(/deleted/i);
  });
});