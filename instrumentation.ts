// Выполняется один раз при старте сервера Next.js. Запускает фоновую каденцию первых контактов, если она
// включена переменной FIRST_CONTACT_CADENCE=on. Node-код вынесен в instrumentation-node.ts и подключается
// только внутри этой проверки: иначе Next пытается собрать драйвер MongoDB и для edge-среды, и сборка падает.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
