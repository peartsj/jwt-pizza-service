let mockNextExecuteBehavior;
let mockNextQueryBehavior;

jest.mock('mysql2/promise', () => {
  return {
    createConnection: jest.fn(async () => {
      const connection = {
        execute: jest.fn(async (sql, params) => {
          return [await mockNextExecuteBehavior(sql, params)];
        }),
        query: jest.fn(async (sql, params) => {
          return [await mockNextQueryBehavior(sql, params)];
        }),
        beginTransaction: jest.fn(async () => {}),
        commit: jest.fn(async () => {}),
        rollback: jest.fn(async () => {}),
        end: jest.fn(() => {}),
      };
      return connection;
    }),
  };
});

jest.mock('bcrypt', () => ({
  hash: jest.fn(async (v) => `hashed:${v}`),
  compare: jest.fn(async () => true),
}));

function defaultExecuteBehavior(sql) {
  if (String(sql).includes('INFORMATION_SCHEMA.SCHEMATA')) {
    return [{ SCHEMA_NAME: 'pizza' }];
  }
  if (String(sql).startsWith('SELECT id FROM')) {
    return [{ id: 1 }];
  }
  if (String(sql).startsWith('SELECT * FROM user WHERE email=')) {
    return [{ id: 1, name: 'u', email: 'u@jwt.com', password: 'hashed:pw' }];
  }
  if (String(sql).startsWith('SELECT * FROM userRole WHERE userId=')) {
    return [{ objectId: 0, role: 'diner' }];
  }
  if (String(sql).startsWith('SELECT * FROM menu')) {
    return [{ id: 1, title: 'Veggie', description: 'A', image: 'pizza.png', price: 0.01 }];
  }
  return [];
}

function defaultQueryBehavior(_sql) {
  return [];
}

describe('database DB module', () => {
  beforeEach(() => {
    jest.resetModules();
    mockNextExecuteBehavior = jest.fn(async (sql, params) => defaultExecuteBehavior(sql, params));
    mockNextQueryBehavior = jest.fn(async (sql, params) => defaultQueryBehavior(sql, params));
  });

  test('getTokenSignature extracts signature part', async () => {
    const { DB } = require('../src/database/database.js');
    expect(DB.getTokenSignature('a.b.c')).toBe('c');
    expect(DB.getTokenSignature('x')).toBe('');
  });

  test('getOffset returns offset for paging', async () => {
    const { DB } = require('../src/database/database.js');
    expect(DB.getOffset(1, 10)).toBe(0);
    expect(DB.getOffset(2, 10)).toBe(10);
  });

  test('getMenu queries menu table', async () => {
    const { DB } = require('../src/database/database.js');
    const menu = await DB.getMenu();
    expect(Array.isArray(menu)).toBe(true);
    expect(menu[0]).toEqual(expect.objectContaining({ id: 1 }));
  });

  test('addMenuItem inserts and returns id', async () => {
    mockNextExecuteBehavior = jest.fn(async (sql) => {
      if (String(sql).startsWith('INSERT INTO menu')) {
        return { insertId: 42 };
      }
      return defaultExecuteBehavior(sql);
    });

    const { DB } = require('../src/database/database.js');
    const item = await DB.addMenuItem({ title: 't', description: 'd', image: 'i', price: 1 });
    expect(item.id).toBe(42);
  });

  test('getUser returns user with roles and hides password', async () => {
    const { DB } = require('../src/database/database.js');
    const user = await DB.getUser('u@jwt.com', 'pw');
    expect(user.password).toBeUndefined();
    expect(user.roles).toEqual([{ objectId: undefined, role: 'diner' }]);
  });

  test('getUser throws StatusCodeError for unknown user', async () => {
    mockNextExecuteBehavior = jest.fn(async (sql) => {
      if (String(sql).startsWith('SELECT * FROM user WHERE email=')) {
        return [];
      }
      return defaultExecuteBehavior(sql);
    });
    const { DB } = require('../src/database/database.js');
    await expect(DB.getUser('missing@jwt.com', 'pw')).rejects.toMatchObject({ statusCode: 404 });
  });

  test('updateUser updates fields and returns getUser result', async () => {
    let sawUpdate = false;
    mockNextExecuteBehavior = jest.fn(async (sql) => {
      if (String(sql).startsWith('UPDATE user SET')) {
        sawUpdate = true;
        return [];
      }
      return defaultExecuteBehavior(sql);
    });
    const { DB } = require('../src/database/database.js');
    const user = await DB.updateUser(1, 'new', 'u@jwt.com', 'pw');
    expect(sawUpdate).toBe(true);
    expect(user.email).toBe('u@jwt.com');
  });

  test('loginUser/isLoggedIn/logoutUser call auth table', async () => {
    mockNextExecuteBehavior = jest.fn(async (sql) => {
      if (String(sql).startsWith('SELECT userId FROM auth')) return [];
      return defaultExecuteBehavior(sql);
    });
    const { DB } = require('../src/database/database.js');
    await DB.loginUser(1, 'a.b.signature');
    const loggedIn = await DB.isLoggedIn('a.b.signature');
    await DB.logoutUser('a.b.signature');
    expect(loggedIn).toBe(false);
  });

  test('getOrders returns diner orders with items', async () => {
    mockNextExecuteBehavior = jest.fn(async (sql) => {
      if (String(sql).startsWith('SELECT id, franchiseId, storeId, date FROM dinerOrder')) {
        return [{ id: 5, franchiseId: 1, storeId: 2, date: '2024-01-01' }];
      }
      if (String(sql).startsWith('SELECT id, menuId, description, price FROM orderItem')) {
        return [{ id: 1, menuId: 2, description: 'Veggie', price: 0.05 }];
      }
      return defaultExecuteBehavior(sql);
    });
    const { DB } = require('../src/database/database.js');
    const result = await DB.getOrders({ id: 9 }, 1);
    expect(result.dinerId).toBe(9);
    expect(result.orders[0].items.length).toBe(1);
  });

  test('addDinerOrder inserts order and items', async () => {
    mockNextExecuteBehavior = jest.fn(async (sql, params) => {
      if (String(sql).startsWith('INSERT INTO dinerOrder')) {
        return { insertId: 10 };
      }
      if (String(sql).startsWith('INSERT INTO orderItem')) {
        return { insertId: 11 };
      }
      if (String(sql).startsWith('SELECT id FROM menu')) {
        return [{ id: params[0] }];
      }
      return defaultExecuteBehavior(sql, params);
    });
    const { DB } = require('../src/database/database.js');
    const order = await DB.addDinerOrder(
      { id: 9 },
      { franchiseId: 1, storeId: 1, items: [{ menuId: 7, description: 'x', price: 1 }] }
    );
    expect(order.id).toBe(10);
  });

  test('createFranchise throws for unknown admin email', async () => {
    mockNextExecuteBehavior = jest.fn(async (sql) => {
      if (String(sql).startsWith('SELECT id, name FROM user WHERE email=')) {
        return [];
      }
      return defaultExecuteBehavior(sql);
    });
    const { DB } = require('../src/database/database.js');
    await expect(DB.createFranchise({ name: 'x', admins: [{ email: 'missing@jwt.com' }] })).rejects.toMatchObject({ statusCode: 404 });
  });

  test('deleteFranchise rolls back and throws on failure', async () => {
    mockNextExecuteBehavior = jest.fn(async (sql) => {
      if (String(sql).startsWith('DELETE FROM store')) {
        throw new Error('db fail');
      }
      return defaultExecuteBehavior(sql);
    });
    const { DB } = require('../src/database/database.js');
    await expect(DB.deleteFranchise(1)).rejects.toMatchObject({ statusCode: 500 });
  });

  test('getFranchises returns [franchises, more] and loads stores for non-admin', async () => {
    mockNextExecuteBehavior = jest.fn(async (sql) => {
      if (String(sql).startsWith('SELECT id, name FROM franchise')) {
        return [{ id: 1, name: 'f1' }];
      }
      if (String(sql).startsWith('SELECT id, name FROM store WHERE franchiseId=')) {
        return [{ id: 1, name: 'SLC' }];
      }
      return defaultExecuteBehavior(sql);
    });
    const { DB, Role } = require('../src/database/database.js');
    const authUser = { isRole: (r) => r === Role.Diner };
    const [franchises, more] = await DB.getFranchises(authUser, 0, 10, '*');
    expect(more).toBe(false);
    expect(franchises[0].stores).toEqual([{ id: 1, name: 'SLC' }]);
  });
});
