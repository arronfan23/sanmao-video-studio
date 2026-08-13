// 自动更新：拉取 version.json 比对版本 -> 下载 MSI -> 静默安装并退出。
// 更新通道是一个静态托管的清单文件，结构：
// { "version": "0.2.0", "msiUrl": "https://.../Sanmao-Video-Studio-Setup-0.2.0.msi", "notes": "更新内容..." }
// 打包发布新版本时，只需改这里 + 上传 MSI 和 version.json 到同一位置。
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

// 更新通道地址（发布渠道定了之后改这里）
const UPDATE_FEED_URL = 'https://github.com/arronfan23/sanmao-video-studio/releases/latest/download/version.json';

// GitHub 直连在国内可能超时，依次尝试直连和公共加速镜像
const MIRROR_PREFIXES = ['', 'https://ghproxy.net/', 'https://gh-proxy.com/'];

function withMirrors(url) {
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
        const req = https.get(u, { headers: { 'User-Agent': 'SanmaoVideoStudio-Updater' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
            res.resume();
            return follow(res.headers.location, redirects + 1);
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
      const follow = (u) => {
        const req = https.get(u, { headers: { 'User-Agent': 'SanmaoVideoStudio-Updater' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            return follow(res.headers.location);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`下载失败 HTTP ${res.statusCode}`));
          }
          const total = Number(res.headers['content-length']) || 0;
          let got = 0;
          const file = fs.createWriteStream(dest);
          res.on('data', (chunk) => {
            got += chunk.length;
            if (total) onProgress(Math.round((got / total) * 100));
          });
          res.pipe(file);
          file.on('finish', () => file.close(resolve));
          file.on('error', reject);
        });
        req.setTimeout(30000, () => req.destroy(new Error('timeout')));
        req.on('error', reject);
      };
      follow(url);
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
    const child = spawn('msiexec', ['/i', msiPath, '/passive', '/norestart'], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();
    setTimeout(() => app.quit(), 1500);
  }
}

module.exports = { Updater, UPDATE_FEED_URL, compareVersions };
