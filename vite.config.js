import fs from 'node:fs'; import {defineConfig} from 'vite';
const version=process.env.APP_VERSION||process.env.SOURCE_COMMIT||process.env.GIT_COMMIT_SHA||'dev';
export default defineConfig({define:{__APP_VERSION__:JSON.stringify(version)},plugins:[{name:'version-json',closeBundle(){fs.writeFileSync('dist/version.json',JSON.stringify({version})+'\n')}}],server:{port:3000,open:true,proxy:{'/api':'http://127.0.0.1:3001'}},build:{outDir:'dist',assetsDir:'assets',rollupOptions:{input:{main:'index.html',marketing:'marketing.html',settings:'settings.html'}}}});
