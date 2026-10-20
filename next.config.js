/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdfmake читает шрифты с диска, mammoth разбирает .docx: оба не должны собираться webpack-ом.
  experimental: { serverComponentsExternalPackages: ["pdfmake", "mammoth"] },
  async headers() {
    return [
      {
        // Service worker не должен залипать в HTTP-кэше браузера — иначе
        // обновление /sw.js доезжает до установленных приложений днями.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};
module.exports = nextConfig;
