const mockDb = { name: 'mockedDb' };
const mockClient = {
  connect: jest.fn().mockImplementation(async () => mockClient),
  db: jest.fn().mockReturnValue(mockDb),
};

const MockMongoClient = jest.fn().mockImplementation(() => mockClient);

// @types/node помечает NODE_ENV как readonly — прямое присваивание не
// проходит tsc (но раньше молча не падало ни в jest, ни в next build).
// defineProperty — обычный обходной путь для тестов, без приведения к any.
function setNodeEnv(value: string) {
  Object.defineProperty(process.env, "NODE_ENV", { value, configurable: true });
}

jest.mock('mongodb', () => {
  return {
    MongoClient: MockMongoClient,
  };
});

describe('mongodb', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = process.env;
    jest.resetModules();
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    delete global._mongoClientPromise;
  });

  it('should throw an error if MONGODB_URI is not defined', async () => {
    delete process.env.MONGODB_URI;
    const { getDb } = await import('./mongodb');
    await expect(getDb()).rejects.toThrow('MONGODB_URI не задан');
  });

  it('should connect and return db in production mode', async () => {
    process.env.MONGODB_URI = 'mongodb://localhost:27017';
    setNodeEnv('production');

    const { getDb } = await import('./mongodb');

    const db = await getDb();

    expect(MockMongoClient).toHaveBeenCalledWith(
      'mongodb://localhost:27017',
      expect.objectContaining({ serverSelectionTimeoutMS: expect.any(Number) })
    );
    expect(mockClient.connect).toHaveBeenCalled();
    expect(mockClient.db).toHaveBeenCalledWith('meditur');
    expect(db).toBe(mockDb);
  });

  it('should reuse the same connection across calls in production too, not just dev', async () => {
    // Раньше в проде кэша не было вовсе: каждый getDb() заново создавал
    // MongoClient и делал полный TLS-хендшейк — на один вебхук уходило
    // 4-5+ таких пересозданий, что и провоцировало разрывы соединения.
    process.env.MONGODB_URI = 'mongodb://localhost:27017';
    setNodeEnv('production');

    const { getDb } = await import('./mongodb');

    await getDb();
    await getDb();

    expect(MockMongoClient).toHaveBeenCalledTimes(1);
    expect(mockClient.connect).toHaveBeenCalledTimes(1);
  });

  it('should retry connecting after a failed attempt instead of caching the rejection forever', async () => {
    process.env.MONGODB_URI = 'mongodb://localhost:27017';
    setNodeEnv('production');

    mockClient.connect
      .mockImplementationOnce(async () => {
        throw new Error('tlsv1 alert internal error');
      })
      .mockImplementationOnce(async () => mockClient);

    const { getDb } = await import('./mongodb');

    await expect(getDb()).rejects.toThrow('tlsv1 alert internal error');
    const db = await getDb();

    expect(db).toBe(mockDb);
    expect(mockClient.connect).toHaveBeenCalledTimes(2);
  });

  it('should reuse client promise in development mode', async () => {
    process.env.MONGODB_URI = 'mongodb://localhost:27017';
    setNodeEnv('development');

    const { getDb } = await import('./mongodb');

    await getDb();
    const promise1 = global._mongoClientPromise;
    expect(promise1).toBeDefined();

    await getDb();
    const promise2 = global._mongoClientPromise;

    expect(promise1).toBe(promise2);
    expect(MockMongoClient).toHaveBeenCalledTimes(1);
    expect(mockClient.connect).toHaveBeenCalledTimes(1);
  });
});
