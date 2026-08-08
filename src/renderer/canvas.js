// 画布式工作流编辑器：拖节点、连线（类型校验 + 单入线 + 禁环）、
// 参数面板自动渲染、运行状态回显。图逻辑复用 ../shared/graph.js。
(function () {
  const api = window.arkStudio;
  const G = window.Graph;

  const state = {
    modules: new Map(),      // moduleId -> manifest
    nodes: new Map(),        // nodeId -> { id, moduleId, x, y, params }
    edges: [],               // { from, fromPort, to, toPort }
    literals: {},            // nodeId -> { inputName: value }
    selected: null,          // { kind: 'node'|'edge', id }
    nodeSeq: 0,
    modelCache: new Map(),   // modality -> [modelIds]
    spCache: new Map(),      // modelId -> supported_params 数组（参数过滤用）
    zoom: 1,
    pan: { x: 0, y: 0 },
    zoomSens: Number(localStorage.getItem('svs-zoom-sens')) || 3,
    runningNodes: new Set(), // 运行中的节点 id，用于连线动效
    groups: new Map(),       // groupId -> { id, x, y, w, h, title }
    groupSeq: 0,
    clipboard: null,         // 复制的节点数据
    clipboardPos: null,
    pasteCount: 0,
  };

  const CANVAS_SIZE = 4000;
  // 滚轮缩放灵敏度 5 档对应的步进倍率
  const WHEEL_FACTORS = [1.04, 1.07, 1.11, 1.17, 1.25];

  const els = {};

  function init() {
    els.wrap = document.getElementById('canvas-wrap');
    els.content = document.getElementById('canvas-content');
    els.nodesLayer = document.getElementById('nodes-layer');
    els.groupsLayer = document.getElementById('groups-layer');
    els.edgesLayer = document.getElementById('edges-layer');
    els.palette = document.getElementById('palette');
    els.panel = document.getElementById('param-panel');
    els.hint = document.getElementById('canvas-hint');
    els.runStatus = document.getElementById('run-status');

    els.wrap.addEventListener('dragover', (e) => e.preventDefault());
    els.wrap.addEventListener('drop', onDrop);
    els.wrap.addEventListener('mousedown', (e) => {
      if (e.target === els.wrap || e.target === els.nodesLayer || e.target === els.edgesLayer || e.target === els.groupsLayer) {
        select(null);
      }
    });
    document.addEventListener('keydown', onKeyDown);

    // 缩放：Ctrl + 滚轮，以及左上角 + / − 按钮
    els.wrap.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const f = WHEEL_FACTORS[state.zoomSens - 1] || 1.11;
      setZoom(state.zoom * (e.deltaY < 0 ? f : 1 / f));
    }, { passive: false });
    document.getElementById('zoom-in').addEventListener('click', () => setZoom(state.zoom * 1.2));
    document.getElementById('zoom-out').addEventListener('click', () => setZoom(state.zoom / 1.2));
    const sensSel = document.getElementById('zoom-sens');
    sensSel.value = String(state.zoomSens);
    sensSel.addEventListener('change', () => {
      state.zoomSens = Number(sensSel.value);
      localStorage.setItem('svs-zoom-sens', sensSel.value);
    });

    // 中键拖动平移
    els.wrap.addEventListener('mousedown', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      startPanDrag(e);
    });

    document.getElementById('run-pipeline').addEventListener('click', runWorkflow);
    document.getElementById('wf-save').addEventListener('click', saveWorkflow);
    document.getElementById('wf-new').addEventListener('click', newWorkflow);
    document.getElementById('wf-delete').addEventListener('click', deleteWorkflow);
    document.getElementById('group-new').addEventListener('click', () => addGroup());
    document.getElementById('wf-load').addEventListener('change', (e) => {
      if (e.target.value) loadWorkflow(e.target.value);
      e.target.value = '';
    });

    api.onNodeStatus(onNodeStatus);
    // 设置页切换计费通道后，模型候选需要重新拉取
    window.addEventListener('profile-changed', () => {
      state.modelCache.clear();
      state.spCache.clear();
      renderPanel();
    });
    refreshPalette();
    refreshWorkflowList();
    // 初始将画布内容居中
    requestAnimationFrame(() => centerCanvas());
  }

  function applyTransform() {
    // 用 transform 而非 CSS zoom：translate/scale 的坐标语义明确，
    // 视觉位置 = pan + 逻辑坐标 * zoom，与 toCanvas 的换算严格互逆
    els.content.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
    document.getElementById('zoom-label').textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function clampPan() {
    const w = els.wrap.clientWidth;
    const h = els.wrap.clientHeight;
    const scaled = CANVAS_SIZE * state.zoom;
    const slack = 120;
    state.pan.x = Math.min(slack, Math.max(w - scaled - slack, state.pan.x));
    state.pan.y = Math.min(slack, Math.max(h - scaled - slack, state.pan.y));
  }

  function centerCanvas() {
    const w = els.wrap.clientWidth;
    const h = els.wrap.clientHeight;
    const scaled = CANVAS_SIZE * state.zoom;
    state.pan.x = (w - scaled) / 2;
    state.pan.y = (h - scaled) / 2;
    clampPan();
    applyTransform();
    renderEdges();
  }

  function startPanDrag(e) {
    els.wrap.classList.add('panning');
    const startX = e.clientX - state.pan.x;
    const startY = e.clientY - state.pan.y;
    const move = (ev) => {
      state.pan.x = ev.clientX - startX;
      state.pan.y = ev.clientY - startY;
      clampPan();
      applyTransform();
    };
    const up = () => {
      els.wrap.classList.remove('panning');
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  function setZoom(z) {
    const next = Math.min(2, Math.max(0.3, Math.round(z * 100) / 100));
    // 以视口中心为锚点缩放
    const cx = els.wrap.clientWidth / 2;
    const cy = els.wrap.clientHeight / 2;
    const ax = (cx - state.pan.x) / state.zoom;
    const ay = (cy - state.pan.y) / state.zoom;
    state.zoom = next;
    state.pan.x = cx - ax * next;
    state.pan.y = cy - ay * next;
    clampPan();
    applyTransform();
    renderEdges();
  }

  // 视口坐标 -> 画布逻辑坐标（与缩放无关）
  function toCanvas(clientX, clientY) {
    const rect = els.wrap.getBoundingClientRect();
    return {
      x: (clientX - rect.left - state.pan.x) / state.zoom,
      y: (clientY - rect.top - state.pan.y) / state.zoom,
    };
  }

  async function refreshPalette() {
    const modules = await api.listModules();
    state.modules = new Map(modules.map((m) => [m.id, m]));
    const groups = {};
    for (const m of modules) {
      (groups[m.category] = groups[m.category] || []).push(m);
    }
    // 保留面板顶部的「新建分组」按钮，只清分类条目
    els.palette.querySelectorAll('.palette-cat, .palette-item').forEach((el) => el.remove());
    for (const [cat, mods] of Object.entries(groups)) {
      const h = document.createElement('div');
      h.className = 'palette-cat';
      h.textContent = cat;
      els.palette.appendChild(h);
      for (const m of mods) {
        const item = document.createElement('div');
        item.className = 'palette-item';
        item.textContent = m.name;
        item.draggable = true;
        item.dataset.moduleId = m.id;
        item.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/module-id', m.id);
        });
        els.palette.appendChild(item);
      }
    }
  }

  function onDrop(e) {
    e.preventDefault();
    // 从桌面/文件管理器拖入文件：自动建「图片」或「视频」输入节点
    if (e.dataTransfer.files && e.dataTransfer.files.length) {
      const p = toCanvas(e.clientX, e.clientY);
      let offset = 0;
      for (const f of e.dataTransfer.files) {
        const filePath = api.getFilePath(f);
        if (!filePath) continue;
        const ext = filePath.split('.').pop().toLowerCase();
        const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext);
        const isVideo = ['mp4', 'mov', 'webm', 'mkv', 'avi'].includes(ext);
        if (!isImage && !isVideo) continue;
        const nodeId = addNode(isImage ? 'image-input' : 'video-input',
          p.x - 90 + offset, p.y - 20 + offset);
        state.nodes.get(nodeId).params.file = filePath;
        offset += 30;
      }
      renderAll();
      return;
    }
    const moduleId = e.dataTransfer.getData('text/module-id');
    if (!moduleId || !state.modules.has(moduleId)) return;
    const p = toCanvas(e.clientX, e.clientY);
    addNode(moduleId, p.x - 90, p.y - 20);
  }

  function addNode(moduleId, x, y) {
    const id = `n_${++state.nodeSeq}_${Date.now() % 100000}`;
    state.nodes.set(id, { id, moduleId, x: Math.max(0, x), y: Math.max(0, y), params: {} });
    renderAll();
    select({ kind: 'node', id });
    return id;
  }

  function removeNode(id) {
    state.nodes.delete(id);
    delete state.literals[id];
    state.edges = state.edges.filter((e) => e.from !== id && e.to !== id);
    renderAll();
    select(null);
  }

  function portTypes(nodeId, portName, direction) {
    const node = state.nodes.get(nodeId);
    if (!node) return null;
    const mod = state.modules.get(node.moduleId);
    if (!mod) return null;
    const list = direction === 'input' ? mod.inputs : mod.outputs;
    const port = (list || []).find((p) => p.name === portName);
    return port ? port.type : null;
  }

  // ---------- 渲染 ----------
  function renderAll() {
    renderGroups();
    renderNodes();
    renderEdges();
    els.hint.classList.toggle('hidden', state.nodes.size > 0);
  }

  // ---------- 分组框 ----------
  function addGroup(x, y, w, h, title) {
    const id = `g_${++state.groupSeq}_${Date.now() % 100000}`;
    const cx = (els.wrap.clientWidth / 2 - state.pan.x) / state.zoom;
    const cy = (els.wrap.clientHeight / 2 - state.pan.y) / state.zoom;
    state.groups.set(id, {
      id,
      x: x !== undefined ? x : cx - 220,
      y: y !== undefined ? y : cy - 150,
      w: w || 440,
      h: h || 300,
      title: title || `分组 ${state.groupSeq}`,
    });
    renderAll();
    return id;
  }

  function groupMembers(group) {
    // 节点中心落在分组框内即视为成员（移动分组时实时判定）
    const members = [];
    for (const n of state.nodes.values()) {
      const cx = n.x + 100;
      const cy = n.y + 40;
      if (cx >= group.x && cx <= group.x + group.w && cy >= group.y && cy <= group.y + group.h) {
        members.push(n);
      }
    }
    return members;
  }

  function renderGroups() {
    els.groupsLayer.innerHTML = '';
    for (const g of state.groups.values()) {
      const el = document.createElement('div');
      el.className = 'wf-group';
      el.dataset.id = g.id;
      if (state.selected && state.selected.kind === 'group' && state.selected.id === g.id) {
        el.classList.add('selected');
      }
      el.style.left = g.x + 'px';
      el.style.top = g.y + 'px';
      el.style.width = g.w + 'px';
      el.style.height = g.h + 'px';

      const header = document.createElement('div');
      header.className = 'wf-group-header';
      const title = document.createElement('span');
      title.className = 'group-title';
      title.textContent = g.title;
      title.title = '双击重命名';
      title.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        const next = prompt('分组名称', g.title);
        if (next && next.trim()) { g.title = next.trim(); renderGroups(); }
      });
      const del = document.createElement('button');
      del.className = 'group-del';
      del.textContent = '×';
      del.title = '删除分组（不删节点）';
      del.addEventListener('click', (ev) => {
        ev.stopPropagation();
        state.groups.delete(g.id);
        if (state.selected && state.selected.kind === 'group' && state.selected.id === g.id) {
          state.selected = null;
        }
        renderAll();
      });
      header.appendChild(title);
      header.appendChild(del);
      el.appendChild(header);

      header.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || e.target.closest('.group-del')) return;
        select({ kind: 'group', id: g.id });
        startGroupDrag(e, g);
      });

      // 右下角拉伸手柄：拖拽改大小
      const grip = document.createElement('div');
      grip.className = 'group-resize';
      grip.title = '拖动调整大小';
      grip.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        startGroupResize(e, g, el);
      });
      el.appendChild(grip);

      els.groupsLayer.appendChild(el);
    }
  }

  function startGroupResize(e, group, el) {
    e.preventDefault();
    select({ kind: 'group', id: group.id });
    const start = toCanvas(e.clientX, e.clientY);
    const startW = group.w;
    const startH = group.h;
    const move = (ev) => {
      const p = toCanvas(ev.clientX, ev.clientY);
      group.w = Math.max(180, startW + (p.x - start.x));
      group.h = Math.max(120, startH + (p.y - start.y));
      // select() 触发的 renderAll 会重建 DOM，每次都重新取当前元素
      const cur = els.groupsLayer.querySelector(`.wf-group[data-id="${group.id}"]`);
      if (cur) {
        cur.style.width = group.w + 'px';
        cur.style.height = group.h + 'px';
      }
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      highlightGroupUnder(node);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  // 节点拖动结束时，若落入分组框则给分组一个高亮脉冲反馈
  function highlightGroupUnder(node) {
    const cx = node.x + 100;
    const cy = node.y + 40;
    for (const g of state.groups.values()) {
      if (cx >= g.x && cx <= g.x + g.w && cy >= g.y && cy <= g.y + g.h) {
        const el = els.groupsLayer.querySelector(`.wf-group[data-id="${g.id}"]`);
        if (el) {
          el.classList.remove('drop-highlight');
          void el.offsetWidth; // 重启动画
          el.classList.add('drop-highlight');
          setTimeout(() => el.classList.remove('drop-highlight'), 700);
        }
        return;
      }
    }
  }

  function startGroupDrag(e, group) {
    e.preventDefault();
    const members = groupMembers(group);
    const start = toCanvas(e.clientX, e.clientY);
    const move = (ev) => {
      const p = toCanvas(ev.clientX, ev.clientY);
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      group.x += dx;
      group.y += dy;
      for (const n of members) { n.x += dx; n.y += dy; }
      start.x = p.x;
      start.y = p.y;
      renderAll();
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  function renderNodes() {
    els.nodesLayer.innerHTML = '';
    for (const node of state.nodes.values()) {
      const mod = state.modules.get(node.moduleId);
      const el = document.createElement('div');
      el.className = 'wf-node';
      el.dataset.id = node.id;
      el.style.left = node.x + 'px';
      el.style.top = node.y + 'px';
      if (state.selected && state.selected.kind === 'node' && state.selected.id === node.id) {
        el.classList.add('selected');
      }
      const status = node._status || '';
      if (status) el.classList.add(`st-${status}`);
      el.title = node._error || (mod ? mod.description : `未知模块 ${node.moduleId}`);

      const header = document.createElement('div');
      header.className = 'wf-node-header';
      const displayName = node.label || (mod ? mod.name : node.moduleId);
      header.innerHTML = `<span class="node-dot"></span><span class="node-name" title="${mod ? mod.name : node.moduleId}">${displayName}</span>`;
      const del = document.createElement('button');
      del.className = 'node-del';
      del.textContent = '×';
      del.title = '删除节点';
      del.addEventListener('click', (ev) => { ev.stopPropagation(); removeNode(node.id); });
      header.appendChild(del);
      el.appendChild(header);

      const ports = document.createElement('div');
      ports.className = 'wf-node-ports';
      ports.appendChild(renderPorts(node, mod ? mod.inputs : [], 'in'));
      ports.appendChild(renderPorts(node, mod ? mod.outputs : [], 'out'));
      el.appendChild(ports);

      el.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('.port') || e.target.closest('.node-del')) return;
        select({ kind: 'node', id: node.id });
        startNodeDrag(e, node);
      });
      els.nodesLayer.appendChild(el);
    }
  }

  function renderPorts(node, list, dir) {
    const col = document.createElement('div');
    col.className = dir === 'in' ? 'ports-in' : 'ports-out';
    for (const p of list || []) {
      const row = document.createElement('div');
      row.className = `port port-${dir}`;
      row.dataset.node = node.id;
      row.dataset.port = p.name;
      const wired = dir === 'in' && state.edges.some((e) => e.to === node.id && e.toPort === p.name);
      row.innerHTML = `<i class="${wired ? 'wired' : ''}"></i><label>${p.label || p.name}${p.required ? ' *' : ''}</label>`;
      if (dir === 'out') {
        row.querySelector('i').addEventListener('mousedown', (e) => startEdgeDrag(e, node.id, p.name));
      }
      col.appendChild(row);
    }
    return col;
  }

  function portCenter(nodeId, portName, dir) {
    const row = els.nodesLayer.querySelector(
      `.port-${dir === 'in' ? 'in' : 'out'}[data-node="${nodeId}"][data-port="${portName}"] i`
    );
    if (!row) return null;
    const r = row.getBoundingClientRect();
    return toCanvas(r.left + r.width / 2, r.top + r.height / 2);
  }

  function edgePath(a, b) {
    const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  }

  function renderEdges(tempPath) {
    els.edgesLayer.innerHTML = '';
    els.edgesLayer.setAttribute('width', CANVAS_SIZE);
    els.edgesLayer.setAttribute('height', CANVAS_SIZE);
    for (const e of state.edges) {
      const a = portCenter(e.from, e.fromPort, 'out');
      const b = portCenter(e.to, e.toPort, 'in');
      if (!a || !b) continue;
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', edgePath(a, b));
      p.classList.add('edge');
      if (state.runningNodes.has(e.to)) p.classList.add('active');
      if (state.selected && state.selected.kind === 'edge'
        && state.selected.id === edgeId(e)) p.classList.add('selected');
      p.addEventListener('mousedown', (ev) => {
        ev.stopPropagation();
        select({ kind: 'edge', id: edgeId(e) });
      });
      els.edgesLayer.appendChild(p);
    }
    if (tempPath) els.edgesLayer.appendChild(tempPath);
  }

  function edgeId(e) {
    return `${e.from}:${e.fromPort}->${e.to}:${e.toPort}`;
  }

  // ---------- 交互 ----------
  function startNodeDrag(e, node) {
    e.preventDefault();
    const start = toCanvas(e.clientX, e.clientY);
    const offX = start.x - node.x;
    const offY = start.y - node.y;
    const move = (ev) => {
      const p = toCanvas(ev.clientX, ev.clientY);
      node.x = Math.max(0, p.x - offX);
      node.y = Math.max(0, p.y - offY);
      const el = els.nodesLayer.querySelector(`.wf-node[data-id="${node.id}"]`);
      if (el) { el.style.left = node.x + 'px'; el.style.top = node.y + 'px'; }
      renderEdges();
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  function startEdgeDrag(e, fromNode, fromPort) {
    e.preventDefault();
    e.stopPropagation();
    const move = (ev) => {
      const a = portCenter(fromNode, fromPort, 'out');
      if (!a) return;
      const b = toCanvas(ev.clientX, ev.clientY);
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', edgePath(a, b));
      p.classList.add('edge', 'temp');
      renderEdges(p);
    };
    const up = (ev) => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      const target = ev.target.closest && ev.target.closest('.port-in');
      renderEdges();
      if (!target) return;
      const cand = { from: fromNode, fromPort, to: target.dataset.node, toPort: target.dataset.port };
      const verdict = G.validateConnection(state.edges, cand, portTypes);
      if (!verdict.ok) {
        flashStatus(connectError(verdict, cand), true);
        return;
      }
      if (verdict.replace) {
        flashStatus(`「${nodeName(cand.to)}」的该输入已有连接，已替换为新连线`, false);
      }
      const inType = portTypes(cand.to, cand.toPort, 'input');
      state.edges = G.upsertEdge(state.edges, cand, inType);
      renderAll();
      renderPanel();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  function nodeName(id) {
    const node = state.nodes.get(id);
    if (!node) return id;
    if (node.label) return node.label;
    const mod = state.modules.get(node.moduleId);
    return mod ? mod.name : node.moduleId;
  }

  // PM 定稿文案：不能连接 + 来源 → 目标 + 原因 + 怎么办
  function connectError(verdict, cand) {
    const srcMod = state.modules.get((state.nodes.get(cand.from) || {}).moduleId);
    const dstMod = state.modules.get((state.nodes.get(cand.to) || {}).moduleId);
    const inPort = dstMod && (dstMod.inputs || []).find((p) => p.name === cand.toPort);
    const inLabel = (inPort && inPort.label) || cand.toPort;
    if (verdict.reason === 'type-mismatch') {
      return `「${nodeName(cand.from)}」的输出不能连到「${nodeName(cand.to)}」的${inLabel}输入：`
        + `需要${G.typeLabel(verdict.inType.replace('[]', ''))}类型，当前是${G.typeLabel(verdict.outType)}`;
    }
    if (verdict.reason === 'cycle') {
      return `不能这样连接：「${nodeName(cand.to)}」的输出回到它的上游会形成循环依赖`;
    }
    if (verdict.reason === 'duplicate') {
      return '该视频已加入合成列表，无需重复连接';
    }
    return '端口不存在或已失效，请重拖该节点';
  }

  function onKeyDown(e) {
    const typing = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT';

    // Ctrl+C 复制选中节点
    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C') && !typing) {
      if (state.selected && state.selected.kind === 'node') {
        const node = state.nodes.get(state.selected.id);
        if (node) {
          state.clipboard = {
            moduleId: node.moduleId,
            params: JSON.parse(JSON.stringify(node.params)),
            label: node.label || null,
            literals: state.literals[node.id] ? JSON.parse(JSON.stringify(state.literals[node.id])) : {},
          };
          state.clipboardPos = { x: node.x, y: node.y };
          state.pasteCount = 0;
          flashStatus('已复制节点', false);
        }
      }
      return;
    }

    // Ctrl+V 粘贴：每次偏移 30px，备注名加「副本」
    if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V') && !typing) {
      if (state.clipboard) {
        state.pasteCount++;
        const base = state.clipboardPos || { x: 400, y: 300 };
        const id = addNode(state.clipboard.moduleId,
          base.x + 30 * state.pasteCount, base.y + 30 * state.pasteCount);
        const node = state.nodes.get(id);
        node.params = JSON.parse(JSON.stringify(state.clipboard.params));
        node.label = state.clipboard.label ? `${state.clipboard.label} 副本` : null;
        state.literals[id] = JSON.parse(JSON.stringify(state.clipboard.literals || {}));
        renderAll();
        renderPanel();
      }
      return;
    }

    if (e.key !== 'Delete' && e.key !== 'Backspace' && e.key !== 'Escape') return;
    if (typing) return;
    if (!state.selected) return;
    if (state.selected.kind === 'node') removeNode(state.selected.id);
    if (state.selected.kind === 'group') {
      state.groups.delete(state.selected.id);
      state.selected = null;
      renderAll();
      renderPanel();
    }
    if (state.selected.kind === 'edge') {
      state.edges = state.edges.filter((ed) => edgeId(ed) !== state.selected.id);
      renderAll();
      select(null);
    }
  }

  function select(sel) {
    state.selected = sel;
    renderAll();
    renderPanel();
  }

  function flashStatus(msg, isError) {
    els.runStatus.textContent = msg;
    els.runStatus.className = 'run-status ' + (isError ? 'err' : 'ok');
    setTimeout(() => { els.runStatus.textContent = ''; els.runStatus.className = 'run-status'; }, 4000);
  }

  // ---------- 参数面板 ----------
  async function renderPanel() {
    if (state.selected && state.selected.kind === 'group') {
      const g = state.groups.get(state.selected.id);
      if (!g) { els.panel.innerHTML = ''; return; }
      els.panel.innerHTML = '<h3 class="panel-title">分组</h3>';
      const row = document.createElement('div');
      row.className = 'panel-field';
      row.innerHTML = '<label>名称</label>';
      const inp = document.createElement('input');
      inp.value = g.title;
      inp.addEventListener('input', () => {
        g.title = inp.value.trim() || g.title;
        renderGroups();
      });
      row.appendChild(inp);
      els.panel.appendChild(row);
      const hint = document.createElement('div');
      hint.className = 'empty-hint';
      hint.textContent = `${groupMembers(g).length} 个节点在组内 · Delete 键删除分组`;
      els.panel.appendChild(hint);
      return;
    }
    if (!state.selected || state.selected.kind !== 'node') {
      els.panel.innerHTML = '<div class="empty-hint">选中一个节点查看参数</div>';
      return;
    }
    const node = state.nodes.get(state.selected.id);
    if (!node) { els.panel.innerHTML = ''; return; }
    const mod = state.modules.get(node.moduleId);
    if (!mod) { els.panel.innerHTML = '<div class="empty-hint">模块未注册</div>'; return; }

    els.panel.innerHTML = `<h3 class="panel-title">${mod.name}</h3>`;

    // 备注名：显示在节点卡片上，比如「镜头一」
    const labelRow = document.createElement('div');
    labelRow.className = 'panel-field';
    labelRow.innerHTML = '<label>备注名</label>';
    const labelInput = document.createElement('input');
    labelInput.placeholder = mod.name;
    labelInput.value = node.label || '';
    labelInput.addEventListener('input', () => {
      node.label = labelInput.value.trim() || null;
      renderNodes();
    });
    labelRow.appendChild(labelInput);
    els.panel.appendChild(labelRow);

    // 输入绑定区
    if ((mod.inputs || []).length) {
      const sec = document.createElement('div');
      sec.className = 'panel-section';
      sec.innerHTML = '<div class="panel-label">输入</div>';
      for (const input of mod.inputs) {
        const wiredEdge = state.edges.find((e) => e.to === node.id && e.toPort === input.name);
        const row = document.createElement('div');
        row.className = 'panel-field';
        if (wiredEdge) {
          const src = state.nodes.get(wiredEdge.from);
          const srcMod = src && state.modules.get(src.moduleId);
          row.innerHTML = `<label>${input.label || input.name}${input.required ? ' *' : ''}</label>
            <div class="wired-hint">已连接 ← ${srcMod ? srcMod.name : wiredEdge.from}.${wiredEdge.fromPort}</div>`;
        } else {
          row.innerHTML = `<label>${input.label || input.name}${input.required ? ' *' : ''}</label>`;
          const isFile = input.type === 'image' || input.type === 'video';
          const ta = document.createElement(!isFile && input.type === 'text' ? 'textarea' : 'input');
          ta.className = 'literal-input';
          ta.placeholder = isFile ? '本地文件路径，或点右侧按钮选择' : '未连接时可填字面量';
          ta.value = (state.literals[node.id] && state.literals[node.id][input.name]) || '';
          ta.addEventListener('input', () => {
            state.literals[node.id] = state.literals[node.id] || {};
            state.literals[node.id][input.name] = ta.value;
          });
          row.appendChild(ta);
          if (isFile) {
            const pick = document.createElement('button');
            pick.className = 'btn pick-btn';
            pick.textContent = '选择文件';
            pick.addEventListener('click', async () => {
              const kind = input.type === 'video' ? 'video' : 'image';
              const file = await api.pickFile(kind);
              if (!file) return;
              ta.value = file;
              state.literals[node.id] = state.literals[node.id] || {};
              state.literals[node.id][input.name] = file;
            });
            row.appendChild(pick);
          }
        }
        sec.appendChild(row);
      }
      els.panel.appendChild(sec);
    }

    // 参数区（按 module.json params 自动渲染）
    if ((mod.params || []).length) {
      const sec = document.createElement('div');
      sec.className = 'panel-section';
      sec.innerHTML = '<div class="panel-label">参数</div>';
      for (const p of mod.params) {
        // showIf 条件显隐：控制参数取不到值时用其 default
        if (p.showIf) {
          const ctrl = mod.params.find((q) => q.name === p.showIf.param);
          const effective = node.params[p.showIf.param] !== undefined
            ? node.params[p.showIf.param]
            : (ctrl && ctrl.default);
          if (effective !== p.showIf.equals) continue;
        }
        const row = document.createElement('div');
        row.className = 'panel-field';
        row.innerHTML = `<label>${p.label || p.name}${p.required ? ' *' : ''}</label>`;
        sec.appendChild(row);
        row.appendChild(await renderParamControl(node, p, mod));
      }
      els.panel.appendChild(sec);
    }

    // 提示词模块：AI 润色模式下显示生成按钮（强制重新生成，结果回填可编辑）
    if (mod.id === 'prompt-assist' && (node.params.mode || '原文直出') === 'AI 润色') {
      const btn = document.createElement('button');
      btn.className = 'btn primary gen-btn';
      btn.textContent = '生成提示词';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = '生成中...';
        try {
          const inputs = {};
          const lit = state.literals[node.id] || {};
          if (lit.brief) inputs.brief = { value: lit.brief };
          const record = await api.runModule({
            moduleId: mod.id,
            params: { ...node.params, prompt: '' },
            inputs,
          });
          const out = record.outputs && record.outputs.preview;
          if (out && out.prompt) node.params.prompt = out.prompt;
          renderPanel();
        } catch (err) {
          flashStatus(`生成失败: ${err.message}`, true);
        } finally {
          btn.disabled = false;
          btn.textContent = '生成提示词';
        }
      });
      els.panel.appendChild(btn);
    }
  }

  // 拉取所选模型的 supported_params（EP 先经 infer endpoint list 解析出绑定模型名）
  async function getModelConstraints(node, mod) {
    const modelParam = (mod.params || []).find((q) => q.type === 'model');
    if (!modelParam) return null;
    const modelId = node.params[modelParam.name];
    if (!modelId) return null;
    if (state.spCache.has(modelId)) return state.spCache.get(modelId);
    let constraints = null;
    try {
      let query = modelId;
      if (modelId.startsWith('ep-')) {
        const eps = await api.listEndpoints();
        const ep = eps.find((e) => e.id === modelId);
        if (ep && ep.model) query = ep.model;
      }
      const sp = await api.getModelParams(query);
      constraints = Array.isArray(sp) ? sp : (sp && sp.supported_params) || null;
    } catch { /* 查不到就不约束，用清单里的默认选项 */ }
    state.spCache.set(modelId, constraints);
    return constraints;
  }

  async function renderParamControl(node, p, mod) {
    // 按模型 supported_params 收敛该参数：enum 过滤、support=false 隐藏、number 收紧 min/max
    let constraint = null;
    if (p.type !== 'model' && mod) {
      const sp = await getModelConstraints(node, mod);
      if (sp) constraint = sp.find((c) => c.name === p.name) || null;
    }
    const current = node.params[p.name] !== undefined ? node.params[p.name] : (p.default || '');
    const set = (v) => { node.params[p.name] = v; };

    if (p.type === 'enum' || p.type === 'model') {
      const sel = document.createElement('select');
      if (p.type === 'enum') {
        let options = p.options || [];
        if (constraint && Array.isArray(constraint.enum) && constraint.enum.length) {
          const filtered = options.filter((o) => constraint.enum.includes(o));
          if (filtered.length) options = filtered;
        }
        for (const opt of options) {
          const o = document.createElement('option');
          o.value = opt; o.textContent = opt;
          sel.appendChild(o);
        }
        // 当前值被过滤掉时回退到可用首项，避免把非法值发出去
        if (options.length && current && !options.includes(current)) {
          sel.value = options[0];
          set(options[0]);
        } else {
          sel.value = current;
        }
      } else {
        const models = await loadModels(p.modality);
        if (!models.length) {
          const o = document.createElement('option');
          o.value = '';
          o.textContent = p.modality === 'text'
            ? '（请先在设置页配置 LLM 并刷新模型列表）'
            : '（arkcli 未就绪，无法拉取模型）';
          sel.appendChild(o);
        }
        for (const m of models) {
          const entry = typeof m === 'string' ? { value: m, label: m } : m;
          const o = document.createElement('option');
          o.value = entry.value; o.textContent = entry.label;
          sel.appendChild(o);
        }
        sel.value = current;
      }
      sel.addEventListener('change', () => {
        set(sel.value);
        // 模型变更或其他参数的 showIf 受它控制时，重渲染面板（触发参数过滤刷新）
        if (p.type === 'model'
          || (mod && mod.params.some((q) => q.showIf && q.showIf.param === p.name))) {
          renderPanel();
        }
      });
      return sel;
    }
    if (p.type === 'number') {
      const inp = document.createElement('input');
      inp.type = 'number';
      const min = constraint && constraint.min !== undefined ? constraint.min : p.min;
      const max = constraint && constraint.max !== undefined ? constraint.max : p.max;
      if (min !== undefined) inp.min = min;
      if (max !== undefined) inp.max = max;
      inp.value = current;
      inp.addEventListener('input', () => {
        let v = Number(inp.value);
        if (min !== undefined && v < min) v = min;
        if (max !== undefined && v > max) v = max;
        set(v);
      });
      return inp;
    }
    if (p.type === 'boolean') {
      const inp = document.createElement('input');
      inp.type = 'checkbox';
      inp.checked = !!current;
      inp.addEventListener('change', () => set(inp.checked));
      return inp;
    }
    if (p.type === 'file') {
      const wrap = document.createElement('div');
      const inp = document.createElement('input');
      inp.value = current;
      inp.placeholder = '文件路径';
      const preview = document.createElement('div');
      preview.className = 'file-preview';
      const renderPreview = () => {
        preview.innerHTML = '';
        const v = inp.value.trim();
        if (!v) return;
        const url = 'file:///' + encodeURI(v.replace(/\\/g, '/'));
        const media = document.createElement(p.accept === 'video' ? 'video' : 'img');
        media.className = 'file-thumb';
        media.src = url;
        if (p.accept === 'video') { media.muted = true; media.preload = 'metadata'; media.controls = true; }
        preview.appendChild(media);
      };
      inp.addEventListener('input', () => { set(inp.value); renderPreview(); });
      const pick = document.createElement('button');
      pick.className = 'btn pick-btn';
      pick.textContent = '选择文件';
      pick.addEventListener('click', async () => {
        const file = await api.pickFile(p.accept);
        if (!file) return;
        inp.value = file;
        set(file);
        renderPreview();
      });
      wrap.appendChild(inp);
      wrap.appendChild(pick);
      wrap.appendChild(preview);
      renderPreview();
      return wrap;
    }
    const inp = document.createElement(p.type === 'text' ? 'textarea' : 'input');
    inp.value = current;
    inp.addEventListener('input', () => set(inp.value));
    return inp;
  }

  async function loadModels(modality) {
    if (!modality) return [];
    if (state.modelCache.has(modality)) return state.modelCache.get(modality);
    let ids = [];
    try {
      if (modality === 'text') {
        // 文本模型只取设置页 LLM 端点拉到的列表
        ids = await api.listTextModels();
      } else {
        const data = await api.listResources(modality);
        const items = Array.isArray(data) ? data : (data.items || data.data || []);
        ids = items.map((it) => it.id || it.name).filter(Boolean);
        // EP id 换成友好标签：名称（绑定模型）
        if (ids.some((id) => id.startsWith('ep-'))) {
          try {
            const eps = await api.listEndpoints();
            const byId = new Map(eps.map((e) => [e.id, e]));
            ids = ids.map((id) => {
              const ep = byId.get(id);
              return ep ? { value: id, label: `${ep.name}${ep.model ? `（${ep.model}）` : ''}` } : id;
            });
          } catch { /* 拿不到清单就显示原始 id */ }
        }
      }
    } catch { /* arkcli 未就绪 */ }
    state.modelCache.set(modality, ids);
    return ids;
  }

  // ---------- 运行 / 持久化 ----------
  async function runWorkflow() {
    const nodes = [...state.nodes.values()];
    if (!nodes.length) { flashStatus('画布为空', true); return; }
    const problems = G.validateReadiness(nodes, state.edges, state.literals,
      (id) => state.modules.get(id));
    if (problems.length) {
      flashStatus(problems[0].reason, true);
      select({ kind: 'node', id: problems[0].nodeId });
      return;
    }
    for (const n of state.nodes.values()) { n._status = ''; n._error = ''; }
    state.runningNodes.clear();
    renderAll();
    const name = document.getElementById('wf-name').value.trim() || '未命名工作流';
    const pipeline = G.toPipeline(nodes, state.edges, state.literals, name);
    els.runStatus.textContent = '运行中...';
    els.runStatus.className = 'run-status';
    try {
      const record = await api.runPipeline(pipeline);
      flashStatus(`完成（${record.steps.length} 个节点）`, false);
    } catch (err) {
      flashStatus(`失败: ${err.message}`, true);
    }
  }

  function onNodeStatus(evt) {
    const node = state.nodes.get(evt.nodeId);
    if (!node) return;
    node._status = evt.status;
    node._error = evt.error || '';
    if (evt.status === 'running') state.runningNodes.add(evt.nodeId);
    else state.runningNodes.delete(evt.nodeId);
    renderAll();
  }

  async function saveWorkflow() {
    const name = document.getElementById('wf-name').value.trim();
    if (!name) { flashStatus('请先填写工作流名称', true); return; }
    const doc = {
      name,
      nodes: [...state.nodes.values()].map(({ id, moduleId, x, y, params, label }) => ({ id, moduleId, x, y, params, label: label || null })),
      edges: state.edges,
      literals: state.literals,
      groups: [...state.groups.values()],
    };
    await api.saveWorkflow(doc);
    flashStatus('已保存', false);
    refreshWorkflowList();
  }

  async function loadWorkflow(name) {
    const doc = await api.getWorkflow(name);
    if (!doc) { flashStatus('工作流不存在', true); return; }
    state.nodes = new Map();
    for (const n of doc.nodes || []) state.nodes.set(n.id, { ...n });
    state.edges = doc.edges || [];
    state.literals = doc.literals || {};
    state.groups = new Map((doc.groups || []).map((g) => [g.id, g]));
    state.selected = null;
    document.getElementById('wf-name').value = doc.name;
    renderAll();
    renderPanel();
    flashStatus(`已加载「${doc.name}」`, false);
  }

  function newWorkflow() {
    state.nodes = new Map();
    state.edges = [];
    state.literals = {};
    state.groups = new Map();
    state.selected = null;
    document.getElementById('wf-name').value = '';
    renderAll();
    renderPanel();
  }

  async function deleteWorkflow() {
    const name = document.getElementById('wf-name').value.trim();
    if (!name) { flashStatus('没有可删除的工作流', true); return; }
    const existing = await api.getWorkflow(name);
    if (!existing) { flashStatus(`「${name}」未保存过，无需删除`, true); return; }
    if (!confirm(`确定删除工作流「${name}」？此操作不可恢复。`)) return;
    await api.deleteWorkflow(name);
    newWorkflow();
    refreshWorkflowList();
    flashStatus(`已删除「${name}」`, false);
  }

  async function refreshWorkflowList() {
    const sel = document.getElementById('wf-load');
    const list = await api.listWorkflows();
    sel.innerHTML = '<option value="">打开...</option>';
    for (const w of list) {
      const o = document.createElement('option');
      o.value = w.name;
      o.textContent = `${w.name}（${w.nodeCount} 节点）`;
      sel.appendChild(o);
    }
  }

  window.CanvasEditor = { init };
})();
