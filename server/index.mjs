import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.mjs';

const distDir = fileURLToPath(new URL('../dist/',import.meta.url));
if (!existsSync(new URL('../dist/index.html',import.meta.url))) {
  console.error('缺少网页构建文件，请先运行 npm run build。');
  process.exit(1);
}
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT 必须是有效端口。'); process.exit(1);
}
const host = process.env.HOST || '0.0.0.0';
const app = createApp({distDir});
app.listen(port,host,()=>console.log(`同词相遇已启动：http://${host === '0.0.0.0'?'localhost':host}:${port}`));
app.on('error',error=>{console.error('服务启动失败：',error.message);process.exitCode=1});
function shutdown() {
  app.close(()=>process.exit(0));
  setTimeout(()=>process.exit(1),10000).unref();
}
process.once('SIGTERM',shutdown);
process.once('SIGINT',shutdown);
