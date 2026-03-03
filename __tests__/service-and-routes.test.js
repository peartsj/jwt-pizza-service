const request = require('supertest');
const { buildApp, signToken } = require('../test/testAppFactory');

describe('service + routes', () => {
  test('GET / returns welcome + version', async () => {
    const app = buildApp();
    const res = await request(app).get('/').expect(200);
    expect(res.body.message).toMatch(/welcome/i);
    expect(res.body.version).toBeTruthy();
  });

  test('unknown route returns 404', async () => {
    const app = buildApp();
    await request(app).get('/nope').expect(404);
  });

  test('GET /api/docs returns endpoint docs', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/docs').expect(200);
    expect(res.body.version).toBeTruthy();
    expect(Array.isArray(res.body.endpoints)).toBe(true);
    expect(res.body.endpoints.length).toBeGreaterThan(0);
    expect(res.body.config).toEqual(expect.objectContaining({ factory: expect.any(String), db: expect.any(String) }));
  });

  describe('auth', () => {
    test('POST /api/auth validates required fields', async () => {
      const app = buildApp();
      const res = await request(app).post('/api/auth').send({ email: 'x@y.com' }).expect(400);
      expect(res.body.message).toMatch(/required/);
    });

    test('POST /api/auth registers and returns token', async () => {
      const addUser = jest.fn(async (u) => ({ ...u, id: 2, password: undefined }));
      const loginUser = jest.fn(async () => {});
      const app = buildApp({ dbOverrides: { addUser, loginUser } });

      const res = await request(app)
        .post('/api/auth')
        .send({ name: 'n', email: 'e@jwt.com', password: 'p' })
        .expect(200);

      expect(addUser).toHaveBeenCalled();
      expect(loginUser).toHaveBeenCalledWith(2, expect.any(String));
      expect(res.body.user).toEqual(expect.objectContaining({ id: 2, email: 'e@jwt.com' }));
      expect(res.body.token).toEqual(expect.any(String));
    });

    test('PUT /api/auth logs in and returns token', async () => {
      const getUser = jest.fn(async () => ({ id: 1, name: 'a', email: 'a@jwt.com', roles: [{ role: 'admin' }] }));
      const loginUser = jest.fn(async () => {});
      const app = buildApp({ dbOverrides: { getUser, loginUser } });

      const res = await request(app).put('/api/auth').send({ email: 'a@jwt.com', password: 'admin' }).expect(200);
      expect(getUser).toHaveBeenCalledWith('a@jwt.com', 'admin');
      expect(loginUser).toHaveBeenCalledWith(1, expect.any(String));
      expect(res.body.user.email).toBe('a@jwt.com');
    });

    test('DELETE /api/auth requires auth', async () => {
      const app = buildApp();
      await request(app).delete('/api/auth').expect(401);
    });

    test('DELETE /api/auth logs out when authorized', async () => {
      const logoutUser = jest.fn(async () => {});
      const isLoggedIn = jest.fn(async () => true);
      const app = buildApp({ dbOverrides: { logoutUser, isLoggedIn } });

      const token = signToken({ id: 1, name: 'a', email: 'a@jwt.com', roles: [{ role: 'admin' }] });
      const res = await request(app).delete('/api/auth').set('Authorization', `Bearer ${token}`).expect(200);
      expect(res.body.message).toMatch(/logout successful/i);
      expect(logoutUser).toHaveBeenCalled();
    });
  });

  describe('user', () => {
    test('GET /api/user/me requires auth', async () => {
      const app = buildApp();
      await request(app).get('/api/user/me').expect(401);
    });

    test('PUT /api/user/:id forbids updating someone else (non-admin)', async () => {
      const isLoggedIn = jest.fn(async () => true);
      const app = buildApp({ dbOverrides: { isLoggedIn } });
      const token = signToken({ id: 5, name: 'd', email: 'd@jwt.com', roles: [{ role: 'diner' }] });
      await request(app)
        .put('/api/user/1')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'x' })
        .expect(403);
    });

    test('PUT /api/user/:id updates self and returns new token', async () => {
      const isLoggedIn = jest.fn(async () => true);
      const updateUser = jest.fn(async (id, name, email) => ({ id, name, email, roles: [{ role: 'diner' }] }));
      const app = buildApp({ dbOverrides: { isLoggedIn, updateUser } });
      const token = signToken({ id: 1, name: 'd', email: 'd@jwt.com', roles: [{ role: 'diner' }] });

      const res = await request(app)
        .put('/api/user/1')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'new', email: 'new@jwt.com', password: 'pw' })
        .expect(200);

      expect(updateUser).toHaveBeenCalledWith(1, 'new', 'new@jwt.com', 'pw');
      expect(res.body.user).toEqual(expect.objectContaining({ id: 1, name: 'new', email: 'new@jwt.com' }));
      expect(res.body.token).toEqual(expect.any(String));
    });
  });

  describe('order', () => {
    test('GET /api/order/menu returns menu', async () => {
      const getMenu = jest.fn(async () => [{ id: 1 }]);
      const app = buildApp({ dbOverrides: { getMenu } });
      const res = await request(app).get('/api/order/menu').expect(200);
      expect(res.body).toEqual([{ id: 1 }]);
    });

    test('PUT /api/order/menu requires auth', async () => {
      const app = buildApp();
      await request(app).put('/api/order/menu').send({ title: 'x' }).expect(401);
    });

    test('PUT /api/order/menu forbids non-admin', async () => {
      const isLoggedIn = jest.fn(async () => true);
      const app = buildApp({ dbOverrides: { isLoggedIn } });
      const token = signToken({ id: 1, name: 'd', email: 'd@jwt.com', roles: [{ role: 'diner' }] });
      const res = await request(app)
        .put('/api/order/menu')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'x', description: 'd', image: 'i', price: 1 })
        .expect(403);
      expect(res.body.message).toMatch(/unable to add menu item/);
    });

    test('PUT /api/order/menu as admin adds item and returns menu', async () => {
      const isLoggedIn = jest.fn(async () => true);
      const addMenuItem = jest.fn(async () => ({ id: 99 }));
      const getMenu = jest.fn(async () => [{ id: 1 }, { id: 99 }]);
      const app = buildApp({ dbOverrides: { isLoggedIn, addMenuItem, getMenu } });
      const token = signToken({ id: 1, name: 'a', email: 'a@jwt.com', roles: [{ role: 'admin' }] });

      const res = await request(app)
        .put('/api/order/menu')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'x', description: 'd', image: 'i', price: 1 })
        .expect(200);

      expect(addMenuItem).toHaveBeenCalled();
      expect(res.body).toEqual([{ id: 1 }, { id: 99 }]);
    });

    test('GET /api/order requires auth', async () => {
      const app = buildApp();
      await request(app).get('/api/order').expect(401);
    });

    test('GET /api/order returns user orders', async () => {
      const isLoggedIn = jest.fn(async () => true);
      const getOrders = jest.fn(async (user, page) => ({ dinerId: user.id, orders: [], page: page ?? 1 }));
      const app = buildApp({ dbOverrides: { isLoggedIn, getOrders } });
      const token = signToken({ id: 7, name: 'd', email: 'd@jwt.com', roles: [{ role: 'diner' }] });

      const res = await request(app).get('/api/order?page=2').set('Authorization', `Bearer ${token}`).expect(200);
      expect(getOrders).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), '2');
      expect(res.body.dinerId).toBe(7);
    });

    test('POST /api/order success calls factory and returns jwt', async () => {
      const isLoggedIn = jest.fn(async () => true);
      const addDinerOrder = jest.fn(async (_user, order) => ({ ...order, id: 123 }));
      const app = buildApp({ dbOverrides: { isLoggedIn, addDinerOrder } });
      const token = signToken({ id: 7, name: 'd', email: 'd@jwt.com', roles: [{ role: 'diner' }] });

      global.fetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({ reportUrl: 'http://r', jwt: 'factory-jwt' }),
      }));

      const res = await request(app)
        .post('/api/order')
        .set('Authorization', `Bearer ${token}`)
        .send({ franchiseId: 1, storeId: 1, items: [{ menuId: 1, description: 'Veggie', price: 0.05 }] })
        .expect(200);

      expect(addDinerOrder).toHaveBeenCalled();
      expect(res.body.order).toEqual(expect.objectContaining({ id: 123 }));
      expect(res.body.jwt).toBe('factory-jwt');
      expect(res.body.followLinkToEndChaos).toBe('http://r');
    });

    test('POST /api/order factory failure returns 500', async () => {
      const isLoggedIn = jest.fn(async () => true);
      const addDinerOrder = jest.fn(async (_user, order) => ({ ...order, id: 123 }));
      const app = buildApp({ dbOverrides: { isLoggedIn, addDinerOrder } });
      const token = signToken({ id: 7, name: 'd', email: 'd@jwt.com', roles: [{ role: 'diner' }] });

      global.fetch = jest.fn(async () => ({
        ok: false,
        json: async () => ({ reportUrl: 'http://r' }),
      }));

      const res = await request(app)
        .post('/api/order')
        .set('Authorization', `Bearer ${token}`)
        .send({ franchiseId: 1, storeId: 1, items: [{ menuId: 1, description: 'Veggie', price: 0.05 }] })
        .expect(500);

      expect(res.body.message).toMatch(/failed to fulfill order/i);
    });
  });

  describe('franchise', () => {
    test('GET /api/franchise returns franchises and more', async () => {
      const getFranchises = jest.fn(async () => [[{ id: 1, name: 'x' }], true]);
      const app = buildApp({ dbOverrides: { getFranchises } });
      const res = await request(app).get('/api/franchise?page=0&limit=1&name=*').expect(200);
      expect(res.body.franchises).toEqual([{ id: 1, name: 'x' }]);
      expect(res.body.more).toBe(true);
    });

    test('GET /api/franchise/:userId requires auth', async () => {
      const app = buildApp();
      await request(app).get('/api/franchise/1').expect(401);
    });

    test('GET /api/franchise/:userId returns franchises for self', async () => {
      const isLoggedIn = jest.fn(async () => true);
      const getUserFranchises = jest.fn(async () => [{ id: 2 }]);
      const app = buildApp({ dbOverrides: { isLoggedIn, getUserFranchises } });
      const token = signToken({ id: 9, name: 'f', email: 'f@jwt.com', roles: [{ role: 'franchisee' }] });

      const res = await request(app).get('/api/franchise/9').set('Authorization', `Bearer ${token}`).expect(200);
      expect(res.body).toEqual([{ id: 2 }]);
    });

    test('POST /api/franchise forbids non-admin', async () => {
      const isLoggedIn = jest.fn(async () => true);
      const app = buildApp({ dbOverrides: { isLoggedIn } });
      const token = signToken({ id: 9, name: 'f', email: 'f@jwt.com', roles: [{ role: 'diner' }] });
      await request(app).post('/api/franchise').set('Authorization', `Bearer ${token}`).send({ name: 'x', admins: [] }).expect(403);
    });

    test('POST /api/franchise creates franchise for admin', async () => {
      const isLoggedIn = jest.fn(async () => true);
      const createFranchise = jest.fn(async (f) => ({ ...f, id: 77 }));
      const app = buildApp({ dbOverrides: { isLoggedIn, createFranchise } });
      const token = signToken({ id: 1, name: 'a', email: 'a@jwt.com', roles: [{ role: 'admin' }] });

      const res = await request(app)
        .post('/api/franchise')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'pizzaPocket', admins: [{ email: 'f@jwt.com' }] })
        .expect(200);
      expect(res.body.id).toBe(77);
    });

    test('POST /api/franchise/:id/store forbids non-admin non-franchise-admin', async () => {
      const isLoggedIn = jest.fn(async () => true);
      const getFranchise = jest.fn(async () => ({ id: 5, admins: [{ id: 123 }] }));
      const app = buildApp({ dbOverrides: { isLoggedIn, getFranchise } });
      const token = signToken({ id: 9, name: 'f', email: 'f@jwt.com', roles: [{ role: 'franchisee' }] });
      await request(app)
        .post('/api/franchise/5/store')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'SLC' })
        .expect(403);
    });
  });
});
