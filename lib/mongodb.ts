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
  const client = new MongoClient(uri, {
    // Раньше не задавалось вообще — драйвер ждёт выбора сервера до 30с по
    // умолчанию на КАЖДЫЙ вызов, прежде чем сдаться. При перебоях на
    // стороне Atlas (например, "tlsv1 alert internal error" при хендшейке)
    // это означало: 30с на один вызов, потом ещё 30с на следующий — одно
    // сообщение пациента могло зависать на минуты суммарно.
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000,
  });
  return client.connect();
}

// ВАЖНО: раньше в проде (NODE_ENV !== "development") этот промис вообще не
// кэшировался — getClientPromise() каждый раз создавал НОВЫЙ MongoClient и
// делал полный TLS-хендшейк с нуля. На один вебхук уходит 4-5+ обращений к
// getDb() (heartbeat, поиск/создание лида, сохранение сообщения, медиа,
// обновление стадии...) — то есть 4-5+ самостоятельных пересозданий
// соединения на каждое сообщение пациента. Это не только медленно: частые
// холодные переподключения — ровно то, что провоцирует разрывы
// TLS-хендшейка вроде увиденного в логах. Процесс здесь держит
// WEB_CONCURRENCY=1 (один долгоживущий Node-процесс, не serverless-функции
// с холодным стартом на каждый вызов) — кэшировать соединение на уровне
// модуля корректно и в проде, это стандартная рекомендация MongoDB для
// Node.js-бэкендов, а не только обходной манёвр для hot-reload в dev.
let clientPromise: Promise<MongoClient> | undefined;

function getClientPromise(): Promise<MongoClient> {
  if (process.env.NODE_ENV === "development") {
    // В dev Next.js перезагружает модули при каждом изменении файла —
    // храним промис на global, а не на переменной модуля, чтобы и он не
    // создавался заново при каждом hot-reload.
    if (!global._mongoClientPromise) {
      global._mongoClientPromise = createClientPromise().catch((err) => {
        global._mongoClientPromise = undefined;
        throw err;
      });
    }
    return global._mongoClientPromise;
  }
  if (!clientPromise) {
    // Если подключение однажды упало, промис остаётся "зарезолвленным в
    // отказ" навсегда, если его не сбросить — иначе следующий вызов просто
    // повторит тот же проваленный промис вместо попытки переподключиться.
    clientPromise = createClientPromise().catch((err) => {
      clientPromise = undefined;
      throw err;
    });
  }
  return clientPromise;
}

export async function getDb(): Promise<Db> {
  const client = await getClientPromise();
  // Имя базы задаём явно, а не полагаемся на путь в MONGODB_URI — иначе
  // легко случайно попасть в базу "test", если её забыли указать в строке
  // подключения.
  return client.db("meditur");
}
