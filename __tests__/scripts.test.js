describe('scripts', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('src/index.js listens on provided port', () => {
    jest.isolateModules(() => {
      const listen = jest.fn((port, cb) => cb && cb());
      jest.doMock('../src/service.js', () => ({ listen }));
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const oldArgv = process.argv;
      process.argv = ['node', 'src/index.js', '4567'];
      require('../src/index.js');
      process.argv = oldArgv;

      expect(listen).toHaveBeenCalledWith('4567', expect.any(Function));
      expect(logSpy).toHaveBeenCalled();
      logSpy.mockRestore();
    });
  });

  test('src/init.js exits with usage when args missing', () => {
    jest.isolateModules(() => {
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`exit:${code}`);
      });
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.doMock('../src/database/database.js', () => ({
        Role: { Admin: 'admin' },
        DB: { addUser: jest.fn(async () => ({})) },
      }));

      const oldArgv = process.argv;
      process.argv = ['node', 'src/init.js'];
      expect(() => require('../src/init.js')).toThrow('exit:1');
      process.argv = oldArgv;

      expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/Usage:/));
      logSpy.mockRestore();
      exitSpy.mockRestore();
    });
  });

  test('src/init.js calls DB.addUser with admin role', async () => {
    const addUser = jest.fn(async (u) => ({ ...u, id: 1 }));

    jest.isolateModules(() => {
      jest.doMock('../src/database/database.js', () => ({
        Role: { Admin: 'admin' },
        DB: { addUser },
      }));
      jest.spyOn(console, 'log').mockImplementation(() => {});

      const oldArgv = process.argv;
      process.argv = ['node', 'src/init.js', 'n', 'e@jwt.com', 'pw'];
      require('../src/init.js');
      process.argv = oldArgv;
    });

    // allow the .then(...) in init.js to flush
    await Promise.resolve();
    expect(addUser).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'n',
        email: 'e@jwt.com',
        password: 'pw',
        roles: [{ role: 'admin' }],
      })
    );
  });
});
