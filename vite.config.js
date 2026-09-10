import { defineConfig } from 'vite';
export default defineConfig({server:{port:3000,open:true,proxy:{'/api':'http://127.0.0.1:3001'}},build:{outDir:'dist',assetsDir:'assets',rollupOptions:{input:{main:'index.html',marketing:'marketing.html',settings:'settings.html'}}}});
