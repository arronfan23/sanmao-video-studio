const fs = require('fs');
const path = require('path');

// 模块注册中心：扫描 modules/ 下每个子目录的 module.json，
// 校验清单并挂载 handler。新增能力 = 新增一个目录，无需改主程序。
class ModuleRegistry {
  constructor(modulesDir) {
    this.modulesDir = modulesDir;
    this.modules = new Map();
  }

  loadAll() {
    this.modules.clear();
    if (!fs.existsSync(this.modulesDir)) return;
    for (const name of fs.readdirSync(this.modulesDir)) {
      const dir = path.join(this.modulesDir, name);
      const manifestPath = path.join(dir, 'module.json');
      if (!fs.statSync(dir).isDirectory() || !fs.existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        this.validate(manifest, name);
        const entry = path.join(dir, manifest.entry || 'handler.js');
        manifest.handler = fs.existsSync(entry) ? require(entry) : null;
        manifest.dir = dir;
        this.modules.set(manifest.id, manifest);
      } catch (err) {
        console.error(`[registry] 模块 ${name} 加载失败: ${err.message}`);
      }
    }
  }

  validate(manifest, dirName) {
    for (const field of ['id', 'name', 'version']) {
      if (!manifest[field]) throw new Error(`module.json 缺少字段 ${field}`);
    }
    if (this.modules.has(manifest.id)) {
      throw new Error(`模块 id 重复: ${manifest.id}`);
    }
  }

  get(id) {
    return this.modules.get(id) || null;
  }

  // 返回给渲染进程的脱敏视图（不带 handler 函数）
  list() {
    return [...this.modules.values()].map((m) => ({
      id: m.id,
      name: m.name,
      version: m.version,
      category: m.category || 'misc',
      description: m.description || '',
      inputs: m.inputs || [],
      outputs: m.outputs || [],
      params: m.params || [],
      ready: !!m.handler,
    }));
  }
}

module.exports = { ModuleRegistry };
