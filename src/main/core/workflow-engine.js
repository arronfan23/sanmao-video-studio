const { EventEmitter } = require('events');

// 工作流引擎：按依赖拓扑序执行流水线节点。
// pipeline = { name, nodes: [{ id, moduleId, params, inputs: { <入参名>: { from: <节点id>, output: <出参名> } | { value } } }] }
// 上游节点的 outputs 通过 inputs 映射喂给下游，形成可组合的工作流。
// events 向 UI 广播节点级状态：{ nodeId, moduleId, status, error? }
class WorkflowEngine {
  constructor({ registry, arkcli, taskQueue, assets, projects, llmApi }) {
    this.registry = registry;
    this.arkcli = arkcli;
    this.llmApi = llmApi;
    this.taskQueue = taskQueue;
    this.assets = assets;
    this.projects = projects;
    this.events = new EventEmitter();
  }

  topoSort(nodes) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const visited = new Map();
    const order = [];
    const visit = (node) => {
      const state = visited.get(node.id);
      if (state === 'done') return;
      if (state === 'visiting') throw new Error(`工作流存在环: ${node.id}`);
      visited.set(node.id, 'visiting');
      for (const input of Object.values(node.inputs || {})) {
        if (input && input.from) {
          const upstream = byId.get(input.from);
          if (!upstream) throw new Error(`节点 ${node.id} 依赖不存在的节点 ${input.from}`);
          visit(upstream);
        }
      }
      visited.set(node.id, 'done');
      order.push(node);
    };
    for (const n of nodes) visit(n);
    return order;
  }

  async run(pipeline) {
    const order = this.topoSort(pipeline.nodes || []);
    const outputsByNode = new Map();
    const runRecord = { name: pipeline.name || '未命名工作流', steps: [], startedAt: Date.now() };

    for (const node of order) {
      const mod = this.registry.get(node.moduleId);
      if (!mod) throw new Error(`未注册的模块: ${node.moduleId}`);
      if (!mod.handler || typeof mod.handler.run !== 'function') {
        throw new Error(`模块 ${node.moduleId} 缺少可执行的 handler.run`);
      }

      const inputs = {};
      for (const [name, binding] of Object.entries(node.inputs || {})) {
        if (binding && binding.multi) {
          // 汇聚口：多条上游连线聚合为数组
          inputs[name] = binding.multi.map((b) => {
            const upstream = outputsByNode.get(b.from) || {};
            return upstream[b.output || name];
          });
        } else if (binding && binding.from) {
          const upstream = outputsByNode.get(binding.from) || {};
          inputs[name] = upstream[binding.output || name];
        } else {
          inputs[name] = binding ? binding.value : undefined;
        }
      }

      const stepCtx = {
        arkcli: this.arkcli,
        llmApi: this.llmApi,
        taskQueue: this.taskQueue,
        assets: this.assets && this.assets.forRun
          ? this.assets.forRun({ workflow: pipeline.name, moduleId: node.moduleId })
          : this.assets,
        projects: this.projects,
        node,
        pipeline,
      };

      const step = { nodeId: node.id, moduleId: node.moduleId, status: 'running' };
      runRecord.steps.push(step);
      this.events.emit('node', { nodeId: node.id, moduleId: node.moduleId, status: 'running' });
      try {
        const outputs = await mod.handler.run(stepCtx, inputs, node.params || {});
        outputsByNode.set(node.id, outputs || {});
        step.status = 'succeeded';
        step.outputs = outputs;
        this.events.emit('node', { nodeId: node.id, moduleId: node.moduleId, status: 'succeeded' });
      } catch (err) {
        step.status = 'failed';
        step.error = err.message;
        runRecord.finishedAt = Date.now();
        this.events.emit('node', { nodeId: node.id, moduleId: node.moduleId, status: 'failed', error: err.message });
        throw Object.assign(err, { runRecord });
      }
    }

    runRecord.status = 'succeeded';
    runRecord.finishedAt = Date.now();
    runRecord.outputs = Object.fromEntries(outputsByNode);
    this.projects.saveRun(runRecord);
    return runRecord;
  }
}

module.exports = { WorkflowEngine };
