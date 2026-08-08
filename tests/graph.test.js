const assert = require('assert');
const Graph = require('../src/shared/graph');

// 类型兼容（新规范：image / video / text，数组仅 video[]）
assert(Graph.typesCompatible('image', 'image'));
assert(Graph.typesCompatible('video', 'video[]'));
assert(Graph.typesCompatible('text', 'text'));
assert(!Graph.typesCompatible('image', 'video'), '图片不能连进视频输入');
assert(!Graph.typesCompatible('video', 'image'));
assert(Graph.isMultiPort('video[]'));
assert(!Graph.isMultiPort('video'));

// 环检测
const edges = [{ from: 'a', fromPort: 'o', to: 'b', toPort: 'i' }];
assert(Graph.wouldCycle(edges, 'b', 'a'), 'b->a 应成环');
assert(!Graph.wouldCycle(edges, 'a', 'c'), 'a->c 不成环');

// 单入线端口：替换语义
const portTypesSingle = (node, port, dir) => (dir === 'input' ? 'text' : 'text');
let v = Graph.validateConnection(edges, { from: 'c', fromPort: 'o', to: 'b', toPort: 'i' }, portTypesSingle);
assert(v.ok && v.replace === true, '已有入线时应标记 replace');
const e2 = Graph.upsertEdge(edges, { from: 'c', fromPort: 'o', to: 'b', toPort: 'i' }, 'text');
assert.strictEqual(e2.length, 1);
assert.strictEqual(e2[0].from, 'c');

// 汇聚口：多入线 + 去重
const portTypesMulti = (node, port, dir) => (dir === 'input' ? 'video[]' : 'video');
let m1 = Graph.validateConnection([], { from: 'a', fromPort: 'v', to: 'm', toPort: 'videos' }, portTypesMulti);
assert(m1.ok);
let cur = Graph.upsertEdge([], { from: 'a', fromPort: 'v', to: 'm', toPort: 'videos' }, 'video[]');
cur = Graph.upsertEdge(cur, { from: 'b', fromPort: 'v', to: 'm', toPort: 'videos' }, 'video[]');
assert.strictEqual(cur.length, 2, '汇聚口应允许多条入线');
const dup = Graph.validateConnection(cur, { from: 'a', fromPort: 'v', to: 'm', toPort: 'videos' }, portTypesMulti);
assert(!dup.ok && dup.reason === 'duplicate', '同来源重复连汇聚口应拒绝');

// 类型不匹配原因
const bad = Graph.validateConnection([], { from: 'a', fromPort: 'o', to: 'b', toPort: 'i' },
  (n, p, dir) => (dir === 'input' ? 'video' : 'image'));
assert(!bad.ok && bad.reason === 'type-mismatch');

// 就绪校验
const modules = { m: { inputs: [{ name: 'prompt', required: true, label: '提示词' }] } };
assert.strictEqual(Graph.validateReadiness([{ id: 'n1', moduleId: 'm' }], [], {}, (id) => modules[id]).length, 1);
assert.strictEqual(Graph.validateReadiness([{ id: 'n1', moduleId: 'm' }], [], { n1: { prompt: 'x' } }, (id) => modules[id]).length, 0);

// toPipeline：汇聚口输出 multi 绑定
const pipeline = Graph.toPipeline(
  [{ id: 'v1', moduleId: 'a' }, { id: 'v2', moduleId: 'a' }, { id: 'mg', moduleId: 'merge' }],
  [
    { from: 'v1', fromPort: 'video', to: 'mg', toPort: 'videos' },
    { from: 'v2', fromPort: 'video', to: 'mg', toPort: 'videos' },
  ],
  {},
  'demo'
);
const mgInputs = pipeline.nodes[2].inputs;
assert(mgInputs.videos.multi, '多线汇聚应生成 multi 绑定');
assert.strictEqual(mgInputs.videos.multi.length, 2);

console.log('graph.test.js 通过：新类型系统 / 单入线替换 / 汇聚多入线 / 去重 / multi 绑定正常');
