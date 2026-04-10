let mockNextExecuteBehavior;
let mockNextQueryBehavior;
let mockLastConnection;

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
      mockLastConnection = connection;
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

  test('getUser rejects blank password when provided', async () => {
    const bcrypt = require('bcrypt');
    bcrypt.compare.mockResolvedValueOnce(false);
    const { DB } = require('../src/database/database.js');

    await expect(DB.getUser('u@jwt.com', '')).rejects.toMatchObject({ statusCode: 404 });
    expect(bcrypt.compare).toHaveBeenCalledWith('', 'hashed:pw');
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
        expect(params[3]).toBe(0.25);
        return { insertId: 11 };
      }
      if (String(sql).startsWith('SELECT id FROM menu')) {
        return [{ id: params[0] }];
      }
      if (String(sql).startsWith('SELECT price FROM menu WHERE id=')) {
        return [{ price: 0.25 }];
      }
      return defaultExecuteBehavior(sql, params);
    });
    const { DB } = require('../src/database/database.js');
    const order = await DB.addDinerOrder(
      { id: 9 },
      { franchiseId: 1, storeId: 1, items: [{ menuId: 7, description: 'x', price: 1 }] }
    );
    expect(order.id).toBe(10);
    expect(order.items[0].price).toBe(0.25);
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

  test('getUsers supports paging, wildcard name filter, and roles', async () => {
    mockNextExecuteBehavior = jest.fn(async (sql, params) => {
      if (String(sql).startsWith('SELECT id, name, email FROM user WHERE name LIKE')) {
        expect(params).toEqual(['ali%']);
        return [
          { id: 3, name: 'alice', email: 'alice@jwt.com' },
          { id: 4, name: 'alicia', email: 'alicia@jwt.com' },
        ];
      }
      if (String(sql).startsWith('SELECT role, objectId FROM userRole WHERE userId=')) {
        return [{ role: 'diner', objectId: 0 }];
      }
      return defaultExecuteBehavior(sql, params);
    });

    const { DB } = require('../src/database/database.js');
    const [users, more] = await DB.getUsers(1, 1, 'ali*');

    expect(more).toBe(true);
    expect(users).toHaveLength(1);
    expect(users[0]).toEqual(
      expect.objectContaining({
        id: 3,
        name: 'alice',
        email: 'alice@jwt.com',
        roles: [{ role: 'diner', objectId: undefined }],
      })
    );
  });

  test('getUsers normalizes invalid page/limit and default name filter', async () => {
    mockNextExecuteBehavior = jest.fn(async (sql, params) => {
      if (String(sql).startsWith('SELECT id, name, email FROM user WHERE name LIKE')) {
        expect(params).toEqual(['%']);
        return [{ id: 1, name: 'u', email: 'u@jwt.com' }];
      }
      if (String(sql).startsWith('SELECT role, objectId FROM userRole WHERE userId=')) {
        return [{ role: 'admin', objectId: 0 }];
      }
      return defaultExecuteBehavior(sql, params);
    });

    const { DB } = require('../src/database/database.js');
    const [users, more] = await DB.getUsers(-1, 0);

    expect(more).toBe(false);
    expect(users).toHaveLength(1);
  });

  test('deleteUser deletes related rows and commits transaction', async () => {
    mockNextExecuteBehavior = jest.fn(async (sql, params) => {
      if (String(sql).startsWith('DELETE FROM user WHERE id=')) {
        expect(params).toEqual([9]);
        return { affectedRows: 1 };
      }
      return defaultExecuteBehavior(sql, params);
    });

    const { DB } = require('../src/database/database.js');
    await DB.deleteUser(9);

    expect(mockLastConnection.beginTransaction).toHaveBeenCalled();
    expect(mockLastConnection.commit).toHaveBeenCalled();
    expect(mockLastConnection.rollback).not.toHaveBeenCalled();
  });

  test('deleteUser returns 404 for unknown user and rolls back', async () => {
    mockNextExecuteBehavior = jest.fn(async (sql, params) => {
      if (String(sql).startsWith('DELETE FROM user WHERE id=')) {
        expect(params).toEqual([1234]);
        return { affectedRows: 0 };
      }
      return defaultExecuteBehavior(sql, params);
    });

    const { DB } = require('../src/database/database.js');
    await expect(DB.deleteUser(1234)).rejects.toMatchObject({ statusCode: 404 });
    expect(mockLastConnection.rollback).toHaveBeenCalled();
  });

  test('deleteUser rolls back if delete query fails', async () => {
    mockNextExecuteBehavior = jest.fn(async (sql, params) => {
      if (String(sql).startsWith('DELETE a FROM auth AS a WHERE a.userId=')) {
        throw new Error('db fail');
      }
      return defaultExecuteBehavior(sql, params);
    });

    const { DB } = require('../src/database/database.js');
    await expect(DB.deleteUser(7)).rejects.toThrow('db fail');
    expect(mockLastConnection.rollback).toHaveBeenCalled();
  });

  test('createFranchise creates franchise and assigns admins', async () => {
    mockNextExecuteBehavior = jest.fn(async (sql, params) => {
      if (String(sql).startsWith('SELECT id, name FROM user WHERE email=')) {
        return [{ id: 4, name: 'fr admin' }];
      }
      if (String(sql).startsWith('INSERT INTO franchise')) {
        return { insertId: 22 };
      }
      if (String(sql).startsWith('INSERT INTO userRole')) {
        return { insertId: 100 };
      }
      return defaultExecuteBehavior(sql, params);
    });

    const { DB, Role } = require('../src/database/database.js');
    const created = await DB.createFranchise({ name: 'pizzaPocket', admins: [{ email: 'fr@jwt.com' }] });

    expect(created.id).toBe(22);
    expect(created.admins).toEqual([{ email: 'fr@jwt.com', id: 4, name: 'fr admin' }]);
    const usedFranchiseeRole = mockNextExecuteBehavior.mock.calls.some(
      ([sql, params]) => String(sql).startsWith('INSERT INTO userRole') && params[1] === Role.Franchisee
    );
    expect(usedFranchiseeRole).toBe(true);
  });

  test('getUserFranchises returns empty when user has no franchises', async () => {
    mockNextExecuteBehavior = jest.fn(async (sql, params) => {
      if (String(sql).startsWith("SELECT objectId FROM userRole WHERE role='franchisee' AND userId=")) {
        expect(params).toEqual([9]);
        return [];
      }
      return defaultExecuteBehavior(sql, params);
    });

    const { DB } = require('../src/database/database.js');
    const franchises = await DB.getUserFranchises(9);
    expect(franchises).toEqual([]);
  });

  test('getUserFranchises loads franchise details when IDs exist', async () => {
    mockNextExecuteBehavior = jest.fn(async (sql, params) => {
      if (String(sql).startsWith("SELECT objectId FROM userRole WHERE role='franchisee' AND userId=")) {
        return [{ objectId: 3 }];
      }
      if (String(sql).startsWith('SELECT id, name FROM franchise WHERE id in')) {
        return [{ id: 3, name: 'f3' }];
      }
      if (String(sql).startsWith("SELECT u.id, u.name, u.email FROM userRole AS ur JOIN user AS u ON u.id=ur.userId WHERE ur.objectId=")) {
        return [{ id: 4, name: 'admin', email: 'a@jwt.com' }];
      }
      if (String(sql).startsWith('SELECT s.id, s.name, COALESCE(SUM(oi.price), 0) AS totalRevenue FROM dinerOrder AS do JOIN orderItem AS oi ON do.id=oi.orderId RIGHT JOIN store AS s ON s.id=do.storeId WHERE s.franchiseId=')) {
        return [{ id: 8, name: 'SLC', totalRevenue: 0 }];
      }
      return defaultExecuteBehavior(sql, params);
    });

    const { DB } = require('../src/database/database.js');
    const franchises = await DB.getUserFranchises(4);

    expect(franchises).toHaveLength(1);
    expect(franchises[0]).toEqual(
      expect.objectContaining({
        id: 3,
        admins: [{ id: 4, name: 'admin', email: 'a@jwt.com' }],
        stores: [{ id: 8, name: 'SLC', totalRevenue: 0 }],
      })
    );
  });

  test('createStore and deleteStore execute expected queries', async () => {
    mockNextExecuteBehavior = jest.fn(async (sql, params) => {
      if (String(sql).startsWith('INSERT INTO store')) {
        expect(params).toEqual([2, 'Provo']);
        return { insertId: 88 };
      }
      return defaultExecuteBehavior(sql, params);
    });

    const { DB } = require('../src/database/database.js');
    const store = await DB.createStore(2, { name: 'Provo' });
    await DB.deleteStore(2, 88);

    expect(store).toEqual({ id: 88, franchiseId: 2, name: 'Provo' });
    const deletedStore = mockNextExecuteBehavior.mock.calls.some(
      ([sql, params]) => String(sql).startsWith('DELETE FROM store WHERE franchiseId=') && params[0] === 2 && params[1] === 88
    );
    expect(deletedStore).toBe(true);
  });

  test('getID throws when no matching row exists', async () => {
    const { DB } = require('../src/database/database.js');
    const fakeConnection = { execute: jest.fn(async () => [[]]) };
    await expect(DB.getID(fakeConnection, 'id', 1000, 'menu')).rejects.toThrow('No ID found');
  });

  test('checkDatabaseExists returns false when schema row is missing', async () => {
    const { DB } = require('../src/database/database.js');
    const fakeConnection = { execute: jest.fn(async () => [[]]) };
    const exists = await DB.checkDatabaseExists(fakeConnection);
    expect(exists).toBe(false);
  });

  test('initializeDatabase handles connection errors gracefully', async () => {
    const { DB } = require('../src/database/database.js');
    const originalGetConnection = DB._getConnection;
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    DB._getConnection = jest.fn(async () => {
      throw new Error('cannot connect');
    });

    await DB.initializeDatabase();

    expect(errorSpy).toHaveBeenCalled();
    DB._getConnection = originalGetConnection;
    errorSpy.mockRestore();
  });
});
