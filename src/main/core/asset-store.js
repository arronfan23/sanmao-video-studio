const fs = require('fs');
const path = require('path');

// 素材库：登记工作流产出的图片/视频/音频，提供统一索引。
// 存储为 userData/data/assets.json + assets/ 目录下的实体文件。
class AssetStore {
  constructor({ dataDir }) {
    this.dir = path.join(dataDir, 'assets');
    this.indexPath = path.join(dataDir, 'assets.json');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  _readIndex() {
    if (!fs.existsSync(this.indexPath)) return [];
    try {
      return JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
    } catch {
      return [];
    }
  }

  _writeIndex(items) {
    fs.writeFileSync(this.indexPath, JSON.stringify(items, null, 2));
  }

  // 把产物文件收进素材库（复制），返回登记记录
  register(filePath, { type, source, workflow = null, module = null } = {}) {
    const items = this._readIndex();
    const stat = fs.statSync(filePath);
    const id = `asset_${Date.now()}_${items.length}`;
    const dest = path.join(this.dir, `${id}${path.extname(filePath)}`);
    fs.copyFileSync(filePath, dest);
    const record = {
      id,
      type: type || 'file',
      source: source || 'unknown',
      workflow,
      module,
      name: path.basename(filePath),
      path: dest,
      size: stat.size,
      createdAt: Date.now(),
    };
    items.push(record);
    this._writeIndex(items);
    return record;
  }

  // 运行期包装：自动带上工作流名与模块来源，handler 无需关心
  forRun({ workflow, moduleId }) {
    return {
      register: (filePath, opts = {}) => this.register(filePath, {
        ...opts,
        workflow: workflow || null,
        module: moduleId || null,
      }),
      list: () => this.list(),
    };
  }

  list() {
    return this._readIndex().sort((a, b) => b.createdAt - a.createdAt);
  }

  // 删除素材：索引记录和实体文件一起清掉
  remove(id) {
    const items = this._readIndex();
    const target = items.find((a) => a.id === id);
    if (!target) return false;
    try {
      if (fs.existsSync(target.path)) fs.unlinkSync(target.path);
    } catch { /* 文件可能已被外部移走，索引照删 */ }
    this._writeIndex(items.filter((a) => a.id !== id));
    return true;
  }

  // 全部删除：返回删除数量
  clear() {
    const items = this._readIndex();
    for (const a of items) {
      try {
        if (fs.existsSync(a.path)) fs.unlinkSync(a.path);
      } catch { /* 文件可能已被外部移走 */ }
    }
    this._writeIndex([]);
    return items.length;
  }
}

module.exports = { AssetStore };
