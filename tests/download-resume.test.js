// 断点续传测试：本地 HTTP 服务器模拟 Range 支持、中途断流、416
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { Updater } = require('../src/main/core/updater');

const PAYLOAD = Buffer.alloc(256 * 1024, 'x'); // 256KB 假 MSI

function makeServer() {
  return http.createServer((req, res) => {
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d+)-/.exec(range);
      const start = m ? Number(m[1]) : 0;
      if (start >= PAYLOAD.length) {
        res.writeHead(416);
        res.end();
        return;
      }
      res.writeHead(206, {
        'Content-Length': PAYLOAD.length - start,
        'Content-Range': `bytes ${start}-${PAYLOAD.length - 1}/${PAYLOAD.length}`,
      });
      res.end(PAYLOAD.slice(start));
      return;
    }
    res.writeHead(200, { 'Content-Length': PAYLOAD.length });
    res.end(PAYLOAD);
  });
}

(async () => {
  const server = makeServer();
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avs-dl-'));
  const updater = new Updater({ dataDir: dir, currentVersion: '0.0.1' });

  // 1. 干净下载
  let dest = await updater.download(`${base}/pkg.msi`, '9.9.9');
  assert.strictEqual(fs.readFileSync(dest).length, PAYLOAD.length);

  // 2. 断点续传：先写一半，重新下载应续传且最终内容完整
  fs.writeFileSync(dest, PAYLOAD.slice(0, PAYLOAD.length / 2));
  dest = await updater.download(`${base}/pkg.msi`, '9.9.9');
  assert.deepStrictEqual(fs.readFileSync(dest), PAYLOAD);

  // 3. 完整文件再触发一次：服务器回 416，应删掉重下且不报错
  dest = await updater.download(`${base}/pkg.msi`, '9.9.9');
  assert.deepStrictEqual(fs.readFileSync(dest), PAYLOAD);

  server.close();
  console.log('download-resume.test.js 通过：干净下载 / 断点续传 / 416 重下正常');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
