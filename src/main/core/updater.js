// 自动更新：拉取 version.json 比对版本 -> 下载 MSI -> 静默安装并退出。
// 更新通道是一个静态托管的清单文件，结构：
// { "version": "0.2.0", "msiUrl": "https://.../Sanmao-Video-Studio-Setup-0.2.0.msi", "notes": "更新内容..." }
// 打包发布新版本时，只需改这里 + 上传 MSI 和 version.json 到同一位置。
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');

// 按 URL 协议选择客户端（生产全是 https，本地测试允许 http）
function clientFor(u) {
  return u.startsWith('http:') ? http : https;
}

// 更新通道地址（发布渠道定了之后改这里）
const UPDATE_FEED_URL = 'https://github.com/arronfan23/sanmao-video-studio/releases/latest/download/version.json';

// GitHub 直连在国内可能超时，依次尝试直连和公共加速镜像
const MIRROR_PREFIXES = ['', 'https://ghproxy.net/', 'https://gh-proxy.com/'];

function withMirrors(url) {
  // 只对 GitHub 域名套镜像，其他地址（含本地测试服务）直连
  if (!/^https:\/\/(github\.com|objects\.githubusercontent\.com)\//.test(url)) return [url];
  return MIRROR_PREFIXES.map((p) => (p ? p + url : url));
}

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

class Updater extends EventEmitter {
  constructor({ dataDir, currentVersion } = {}) {
    super();
    this.currentVersion = currentVersion;
    this.downloadDir = path.join(dataDir || require('os').tmpdir(), 'updates');
  }

  _fetchJson(url) {
    return new Promise((resolve, reject) => {
      const follow = (u, redirects) => {
        const req = clientFor(u).get(u, { headers: { 'User-Agent': 'SanmaoVideoStudio-Updater' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
            res.resume();
            return follow(new URL(res.headers.location, u).toString(), redirects + 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          let body = '';
          res.on('data', (d) => (body += d));
          res.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('格式错误')); } });
        });
        req.setTimeout(15000, () => req.destroy(new Error('timeout')));
        req.on('error', reject);
      };
      follow(url, 0);
    });
  }

  // 直连失败时自动尝试镜像
  async _fetchJsonWithMirrors(url) {
    let lastErr = null;
    for (const u of withMirrors(url)) {
      try {
        return await this._fetchJson(u);
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error(`无法连接更新服务器（已尝试直连与镜像）: ${lastErr && lastErr.message}`);
  }

  async check() {
    const feed = await this._fetchJsonWithMirrors(UPDATE_FEED_URL);
    if (!feed.version || !feed.msiUrl) throw new Error('更新清单缺少 version 或 msiUrl 字段');
    const newer = compareVersions(feed.version, this.currentVersion) > 0;
    return {
      current: this.currentVersion,
      latest: feed.version,
      notes: feed.notes || '',
      msiUrl: feed.msiUrl,
      status: newer ? 'available' : 'latest',
    };
  }

  _download(url, dest, onProgress) {
    return new Promise((resolve, reject) => {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      // 断点续传：已下载的部分写入临时文件，换源/重试时从断点继续
      let existing = 0;
      try { existing = fs.statSync(dest).size; } catch {}
      const follow = (u, redirects) => {
        const headers = { 'User-Agent': 'SanmaoVideoStudio-Updater' };
        if (existing > 0) headers.Range = `bytes=${existing}-`;
        const req = clientFor(u).get(u, { headers }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            if (redirects >= 5) { res.resume(); return reject(new Error('重定向过多')); }
            return follow(new URL(res.headers.location, u).toString(), (redirects || 0) + 1);
          }
          // 416：断点超出文件末尾（比如上次其实已下完），删掉重下
          if (res.statusCode === 416 && existing > 0) {
            res.resume();
            try { fs.unlinkSync(dest); } catch {}
            existing = 0;
            return follow(u, 0);
          }
          const resumed = res.statusCode === 206;
          if (res.statusCode !== 200 && !resumed) {
            res.resume();
            return reject(new Error(`下载失败 HTTP ${res.statusCode}`));
          }
          // 服务器忽略 Range 返回 200：从头下，截断旧文件
          if (!resumed) existing = 0;
          const total = (Number(res.headers['content-length']) || 0) + existing;
          let got = existing;
          const file = fs.createWriteStream(dest, { flags: resumed ? 'a' : 'w' });
          // 停滞检测：连续 30 秒收不到数据才判定失败换源，慢速不算失败
          let stallTimer = null;
          const armStall = () => {
            clearTimeout(stallTimer);
            stallTimer = setTimeout(() => req.destroy(new Error('下载停滞')), 30000);
          };
          armStall();
          res.on('data', (chunk) => {
            got += chunk.length;
            armStall();
            if (total) onProgress(Math.min(99, Math.round((got / total) * 100)));
          });
          res.pipe(file);
          file.on('finish', () => {
            clearTimeout(stallTimer);
            file.close(() => { onProgress(100); resolve(); });
          });
          const fail = (e) => { clearTimeout(stallTimer); file.destroy(); reject(e); };
          file.on('error', fail);
          res.on('error', fail);
        });
        req.on('error', reject);
      };
      follow(url, 0);
    });
  }

  async download(msiUrl, version) {
    const dest = path.join(this.downloadDir, `Sanmao-Video-Studio-Setup-${version}.msi`);
    let lastErr = null;
    for (const u of withMirrors(msiUrl)) {
      try {
        await this._download(u, dest, (p) => this.emit('progress', { phase: 'download', percent: p }));
        return dest;
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error(`下载失败（已尝试直连与镜像）: ${lastErr && lastErr.message}`);
  }

  // 启动 MSI 安装（/passive 会显示进度并请求 UAC），随后退出当前应用
  installAndQuit(msiPath, app) {
    // 装完自动拉起新版：脱离的 cmd 等 msiexec 结束后再启动 exe，本体可先退出
    const exe = process.execPath;
    const cmd = `start "" /wait msiexec /i "${msiPath}" /passive /norestart && start "" "${exe}"`;
    const child = spawn('cmd', ['/c', cmd], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: process.env,
    });
    child.unref();
    setTimeout(() => app.quit(), 1500);
  }
}

module.exports = { Updater, UPDATE_FEED_URL, compareVersions };
