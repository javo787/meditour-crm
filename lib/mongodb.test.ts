const mockDb = { name: 'mockedDb' };
const mockClient = {
  connect: jest.fn().mockImplementation(async () => mockClient),
  db: jest.fn().mockReturnValue(mockDb),
};

const MockMongoClient = jest.fn().mockImplementation(() => mockClient);

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
    process.env.NODE_ENV = 'production';

    const { getDb } = await import('./mongodb');

    const db = await getDb();

    expect(MockMongoClient).toHaveBeenCalledWith('mongodb://localhost:27017');
    expect(mockClient.connect).toHaveBeenCalled();
    expect(mockClient.db).toHaveBeenCalledWith('meditur');
    expect(db).toBe(mockDb);
  });

  it('should reuse client promise in development mode', async () => {
    process.env.MONGODB_URI = 'mongodb://localhost:27017';
    process.env.NODE_ENV = 'development';

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
