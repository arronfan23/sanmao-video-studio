const fs = require('fs');
const path = require('path');

// 凭据存储：API Key 用 Electron safeStorage（Windows 下走 DPAPI，绑定当前用户）
// 加密后落盘。密钥永不进日志、永不进渲染进程（渲染进程只拿到 masked 与布尔状态）。
// 非 Electron 环境（单测）退化为 base64 标记存储，encrypted=false 以便识别。
class CredentialStore {
  constructor({ dataDir }) {
    this.filePath = path.join(dataDir, 'secure-config.json');
    try {
      const { safeStorage } = require('electron');
      this.safeStorage = safeStorage.isEncryptionAvailable() ? safeStorage : null;
    } catch {
      this.safeStorage = null;
    }
  }

  _read() {
    if (!fs.existsSync(this.filePath)) return {};
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      return {};
    }
  }

  _write(data) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }

  get encrypted() {
    return !!this.safeStorage;
  }

  setApiKey(key) {
    const data = this._read();
    if (this.safeStorage) {
      data.apiKey = this.safeStorage.encryptString(key).toString('base64');
      data.encrypted = true;
    } else {
      data.apiKey = Buffer.from(key, 'utf8').toString('base64');
      data.encrypted = false;
    }
    this._write(data);
  }

  // 仅限主进程内部使用，不得通过 IPC 暴露
  getApiKey() {
    const data = this._read();
    if (!data.apiKey) return null;
    try {
      if (data.encrypted && this.safeStorage) {
        return this.safeStorage.decryptString(Buffer.from(data.apiKey, 'base64'));
      }
      return Buffer.from(data.apiKey, 'base64').toString('utf8');
    } catch {
      return null;
    }
  }

  maskedKey() {
    const key = this.getApiKey();
    if (!key) return null;
    if (key.length <= 8) return '****';
    return `${key.slice(0, 4)}****${key.slice(-4)}`;
  }

  clearApiKey() {
    const data = this._read();
    delete data.apiKey;
    delete data.encrypted;
    this._write(data);
  }

  setDefaultTextModel(model) {
    const data = this._read();
    data.defaultTextModel = model;
    this._write(data);
  }

  getDefaultTextModel() {
    return this._read().defaultTextModel || null;
  }

  setBaseUrl(url) {
    const data = this._read();
    data.baseUrl = url;
    this._write(data);
  }

  getBaseUrl() {
    return this._read().baseUrl || null;
  }
}

module.exports = { CredentialStore };
