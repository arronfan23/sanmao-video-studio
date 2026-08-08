const fs = require('fs');
const path = require('path');

// 项目存储：保存工作流定义与运行历史，JSON 落盘。
class ProjectStore {
  constructor({ dataDir }) {
    this.dir = path.join(dataDir, 'projects');
    this.runsDir = path.join(dataDir, 'runs');
    this.workflowsDir = path.join(dataDir, 'workflows');
    fs.mkdirSync(this.dir, { recursive: true });
    fs.mkdirSync(this.runsDir, { recursive: true });
    fs.mkdirSync(this.workflowsDir, { recursive: true });
  }

  _workflowPath(name) {
    const safe = String(name).replace(/[\\/:*?"<>|]/g, '_');
    return path.join(this.workflowsDir, `${safe}.json`);
  }

  // 保存画布文档：{ name, nodes:[{id,moduleId,x,y,params}], edges:[{from,fromPort,to,toPort}], literals }
  saveWorkflow(doc) {
    doc.updatedAt = Date.now();
    fs.writeFileSync(this._workflowPath(doc.name), JSON.stringify(doc, null, 2));
    return doc;
  }

  getWorkflow(name) {
    const file = this._workflowPath(name);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  listWorkflows() {
    return fs.readdirSync(this.workflowsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          const doc = JSON.parse(fs.readFileSync(path.join(this.workflowsDir, f), 'utf8'));
          return { name: doc.name, updatedAt: doc.updatedAt, nodeCount: (doc.nodes || []).length };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  deleteWorkflow(name) {
    const file = this._workflowPath(name);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  savePipeline(pipeline) {
    const file = path.join(this.dir, `${pipeline.name || 'untitled'}.json`);
    fs.writeFileSync(file, JSON.stringify(pipeline, null, 2));
    return file;
  }

  listPipelines() {
    return fs.readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')));
  }

  saveRun(record) {
    const file = path.join(this.runsDir, `run_${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(record, null, 2));
    return file;
  }
}

module.exports = { ProjectStore };
