// 画布图逻辑（纯函数，主进程单测与渲染进程共用）。
// 渲染进程通过 <script> 引入挂到 window.Graph；Node 侧通过 require 使用。
//
// 端口类型规范（PM 定稿）：image / video / text 三种基础类型；
// 数组形态仅 video[]（合成导出的汇聚输入），也是唯一允许多入线的端口形态。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Graph = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const TYPE_LABELS = { image: '图片', video: '视频', text: '文本' };

  function typeLabel(t) {
    return TYPE_LABELS[t] || t || '未知';
  }

  // 类型兼容：完全相同可连；T[] 输入接受 T（汇聚）
  function typesCompatible(outType, inType) {
    if (outType === inType) return true;
    if (inType === outType + '[]') return true;
    return false;
  }

  function isMultiPort(inType) {
    return typeof inType === 'string' && inType.endsWith('[]');
  }

  // 候选边 from->to：若沿现有正向边能从 to 走到 from，则成环
  function wouldCycle(edges, from, to) {
    if (from === to) return true;
    const adj = new Map();
    for (const e of edges) {
      if (!adj.has(e.from)) adj.set(e.from, []);
      adj.get(e.from).push(e.to);
    }
    const stack = [to];
    const seen = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (cur === from) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const next of adj.get(cur) || []) stack.push(next);
    }
    return false;
  }

  // 校验一条候选连线。返回 { ok, reason, replace }
  // reason 取值：'missing-port' | 'type-mismatch' | 'cycle' | 'duplicate'
  // replace=true 表示新线会替换该输入端口的旧线（单入线端口）
  function validateConnection(edges, cand, portTypes) {
    const outType = portTypes(cand.from, cand.fromPort, 'output');
    const inType = portTypes(cand.to, cand.toPort, 'input');
    if (!outType || !inType) return { ok: false, reason: 'missing-port' };
    if (!typesCompatible(outType, inType)) {
      return { ok: false, reason: 'type-mismatch', outType, inType };
    }
    if (wouldCycle(edges, cand.from, cand.to)) {
      return { ok: false, reason: 'cycle' };
    }
    const existing = edges.filter((e) => e.to === cand.to && e.toPort === cand.toPort);
    if (isMultiPort(inType)) {
      // 汇聚口：允许多入线，但同一来源不允许重复
      if (existing.some((e) => e.from === cand.from && e.fromPort === cand.fromPort)) {
        return { ok: false, reason: 'duplicate' };
      }
      return { ok: true };
    }
    return { ok: true, replace: existing.length > 0 };
  }

  // 落线：单入线端口新线替换旧线；汇聚口追加
  function upsertEdge(edges, cand, inType) {
    if (isMultiPort(inType)) return [...edges, cand];
    const rest = edges.filter((e) => !(e.to === cand.to && e.toPort === cand.toPort));
    rest.push(cand);
    return rest;
  }

  // 运行前校验：必填输入必须有连线或字面量
  function validateReadiness(nodes, edges, literals, moduleOf) {
    const problems = [];
    for (const node of nodes) {
      const mod = moduleOf(node.moduleId);
      if (!mod) {
        problems.push({ nodeId: node.id, reason: `模块未注册: ${node.moduleId}` });
        continue;
      }
      for (const input of mod.inputs || []) {
        if (!input.required) continue;
        const wired = edges.some((e) => e.to === node.id && e.toPort === input.name);
        const literal = literals[node.id] && literals[node.id][input.name];
        const hasLiteral = literal !== undefined && literal !== null && literal !== '';
        if (!wired && !hasLiteral) {
          problems.push({ nodeId: node.id, reason: `必填输入「${input.label || input.name}」未连接也未填写` });
        }
      }
    }
    return problems;
  }

  // 画布文档 -> 引擎 pipeline。汇聚口的多条线聚合为 multi 绑定数组
  function toPipeline(nodes, edges, literals, name) {
    return {
      name: name || 'canvas-workflow',
      nodes: nodes.map((n) => {
        const inputs = {};
        const byPort = new Map();
        for (const e of edges.filter((e) => e.to === n.id)) {
          if (!byPort.has(e.toPort)) byPort.set(e.toPort, []);
          byPort.get(e.toPort).push({ from: e.from, output: e.fromPort });
        }
        for (const [port, bindings] of byPort) {
          inputs[port] = bindings.length === 1 ? bindings[0] : { multi: bindings };
        }
        const lit = literals[n.id] || {};
        for (const [k, v] of Object.entries(lit)) {
          if (v !== undefined && v !== null && v !== '' && !inputs[k]) {
            inputs[k] = { value: v };
          }
        }
        return { id: n.id, moduleId: n.moduleId, params: n.params || {}, inputs };
      }),
    };
  }

  return {
    typeLabel, typesCompatible, isMultiPort, wouldCycle,
    validateConnection, upsertEdge, validateReadiness, toPipeline,
  };
});
