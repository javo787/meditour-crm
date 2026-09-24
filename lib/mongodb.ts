import { MongoClient, type Db } from "mongodb";

const uri = process.env.MONGODB_URI;

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

function createClientPromise(): Promise<MongoClient> {
  if (!uri) {
    throw new Error(
      "MONGODB_URI не задан — добавьте строку подключения MongoDB Atlas в .env.local (см. .env.example)"
    );
  }
  const client = new MongoClient(uri);
  return client.connect();
}

function getClientPromise(): Promise<MongoClient> {
  // В dev-режиме Next.js перезагружает модули при каждом изменении файла —
  // храним промис на global, чтобы не плодить новые соединения при каждом
  // hot-reload (стандартная рекомендация MongoDB для Next.js).
  if (process.env.NODE_ENV === "development") {
    if (!global._mongoClientPromise) {
      global._mongoClientPromise = createClientPromise();
    }
    return global._mongoClientPromise;
  }
  return createClientPromise();
}

export async function getDb(): Promise<Db> {
  const client = await getClientPromise();
  // Имя базы задаём явно, а не полагаемся на путь в MONGODB_URI — иначе
  // легко случайно попасть в базу "test", если её забыли указать в строке
  // подключения.
  return client.db("meditur");
}
