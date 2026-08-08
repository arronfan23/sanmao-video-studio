// 注册中心单测：扫描真实 modules/ 目录，校验清单完整性
const path = require('path');
const assert = require('assert');
const { ModuleRegistry } = require('../src/main/core/module-registry');

const registry = new ModuleRegistry(path.join(__dirname, '../modules'));
registry.loadAll();

const list = registry.list();
assert(list.length >= 5, `期望至少 5 个模块，实际 ${list.length}`);

const ids = list.map((m) => m.id);
for (const expected of ['prompt-assist', 'text2image', 'text2video', 'image2video', 'video-merge']) {
  assert(ids.includes(expected), `缺少模块 ${expected}`);
}

for (const m of list) {
  assert(m.ready, `模块 ${m.id} 的 handler 未加载`);
  assert(m.outputs.length > 0, `模块 ${m.id} 未声明输出`);
}

// handler 必须导出 run 函数
for (const id of ids) {
  const mod = registry.get(id);
  assert.strictEqual(typeof mod.handler.run, 'function', `${id} handler.run 缺失`);
}

console.log(`registry.test.js 通过：${list.length} 个模块全部就绪`);
