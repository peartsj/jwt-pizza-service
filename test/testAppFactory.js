const jwt = require('jsonwebtoken');
const config = require('../src/config.js');

function signToken(user) {
  return jwt.sign(user, config.jwtSecret);
}

function buildApp({ dbOverrides = {} } = {}) {
  let app;
  jest.isolateModules(() => {
    const Role = {
      Diner: 'diner',
      Franchisee: 'franchisee',
      Admin: 'admin',
    };

    const defaultDb = {
      isLoggedIn: jest.fn(async () => false),
      loginUser: jest.fn(async () => {}),
      logoutUser: jest.fn(async () => {}),
      addUser: jest.fn(async (u) => ({ ...u, id: 2, password: undefined })),
      getUser: jest.fn(async () => ({ id: 1, name: 'user', email: 'u@jwt.com', roles: [{ role: Role.Diner }] })),
      updateUser: jest.fn(async (id, name, email) => ({ id, name: name ?? 'user', email: email ?? 'u@jwt.com', roles: [{ role: Role.Diner }] })),

      getMenu: jest.fn(async () => [{ id: 1, title: 'Veggie', image: 'pizza1.png', price: 0.0038, description: 'A garden of delight' }]),
      addMenuItem: jest.fn(async (item) => ({ ...item, id: 99 })),
      getOrders: jest.fn(async (user) => ({ dinerId: user.id, orders: [], page: 1 })),
      addDinerOrder: jest.fn(async (_user, order) => ({ ...order, id: 10 })),

      getFranchises: jest.fn(async () => [[], false]),
      getUserFranchises: jest.fn(async () => []),
      createFranchise: jest.fn(async (f) => ({ ...f, id: 1 })),
      deleteFranchise: jest.fn(async () => {}),
      getFranchise: jest.fn(async (f) => ({ ...f, admins: [], stores: [] })),
      createStore: jest.fn(async (_franchiseId, store) => ({ id: 1, ...store, totalRevenue: 0 })),
      deleteStore: jest.fn(async () => {}),
    };

    jest.doMock('../src/database/database.js', () => ({
      Role,
      DB: { ...defaultDb, ...dbOverrides },
    }));

    app = require('../src/service.js');
  });

  return app;
}

module.exports = { buildApp, signToken };
