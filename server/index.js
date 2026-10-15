import fs from 'node:fs';
import path from 'node:path';
import { PORT, HOST, ROOT_DIR } from './config.js';
import { createServer } from './app.js';

const BRAND_ASSETS = [
  'brandmark.webp',
  'logo.jpg',
  'favicon.png',
  'favicon.svg',
  'apple-touch-icon.png',
];

async function ensureBrandAssets() {
  const publicDir = path.join(ROOT_DIR, 'public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  for (const filename of BRAND_ASSETS) {
    const filePath = path.join(publicDir, filename);
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) continue;
    try {
      const res = await fetch(
        `https://raw.githubusercontent.com/vanhao1997/crm-tram-chua-da/main/public/${filename}`
      );
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(filePath, buf);
      }
    } catch {
      // Nếu không tải được lúc khởi động thì trình duyệt dùng fallback URL trực tiếp
    }
  }
}

ensureBrandAssets();

const server = createServer();

server.listen(PORT, HOST, () => {
  console.log('==============================================================');
  console.log(`🚀 CRM Telesale Trạm Chữa Da BSN đang chạy tại: http://${HOST}:${PORT}`);
  console.log('   1) DATA NGUỒN MKT');
  console.log('   2) KHÁCH ĐẶT HẸN');
  console.log('   3) KHÁCH ĐÃ ĐẾN');
  console.log('==============================================================');
});

function shutdown(signal) {
  console.log(`Received ${signal}; shutting down CRM server...`);
  server.close(() => {
    process.exit(0);
  });
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

