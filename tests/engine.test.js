// 引擎单测：拓扑排序 + 输入映射，用假模块跑通数据流
const assert = require('assert');
const { WorkflowEngine } = require('../src/main/core/workflow-engine');

const fakeRegistry = {
  get(id) {
    const mods = {
      a: { handler: { run: async () => ({ prompt: '一只猫在草地上奔跑' }) } },
      b: { handler: { run: async (_ctx, inputs) => ({ video: `video-of:${inputs.prompt}` }) } },
    };
    return mods[id] || null;
  },
};

const engine = new WorkflowEngine({
  registry: fakeRegistry,
  arkcli: null,
  taskQueue: null,
  assets: null,
  projects: { saveRun: () => {} },
});

(async () => {
  const record = await engine.run({
    name: 'test',
    nodes: [
      { id: 'n2', moduleId: 'b', inputs: { prompt: { from: 'n1', output: 'prompt' } } },
      { id: 'n1', moduleId: 'a' },
    ],
  });
  assert.strictEqual(record.status, 'succeeded');
  assert.strictEqual(record.outputs.n2.video, 'video-of:一只猫在草地上奔跑');

  // 环检测
  await assert.rejects(
    engine.run({
      nodes: [
        { id: 'x', moduleId: 'a', inputs: { prompt: { from: 'y' } } },
        { id: 'y', moduleId: 'b', inputs: { prompt: { from: 'x' } } },
      ],
    }),
    /环/
  );

  console.log('engine.test.js 通过：拓扑执行、输入映射、环检测正常');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
