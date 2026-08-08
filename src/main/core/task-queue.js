const { EventEmitter } = require('events');
const crypto = require('crypto');

// 任务队列：统一管理工作流内产生的异步作业。
// 视频生成是异步的（task_id -> queued -> running -> succeeded），
// 这里负责轮询 arkcli gen get 直到终态，并向 UI 广播进度。
class TaskQueue extends EventEmitter {
  constructor({ arkcli, pollIntervalMs = 8000, maxPollMs = 30 * 60 * 1000 } = {}) {
    super();
    this.arkcli = arkcli;
    this.pollIntervalMs = pollIntervalMs;
    this.maxPollMs = maxPollMs;
    this.jobs = new Map();
  }

  submit({ kind, label, meta = {}, runner }) {
    const job = {
      id: crypto.randomUUID(),
      kind,
      label,
      meta,
      status: 'pending',
      result: null,
      error: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.jobs.set(job.id, job);
    this._patch(job, { status: 'running' });
    Promise.resolve()
      .then(() => runner(job))
      .then((result) => this._patch(job, { status: 'succeeded', result }))
      .catch((err) => this._patch(job, { status: 'failed', error: err.message }));
    return job;
  }

  // 跟踪一个 arkcli 异步生成任务直到终态
  trackGenTask(taskId, { label, saveTo } = {}) {
    return this.submit({
      kind: 'gen',
      label: label || `生成任务 ${taskId}`,
      meta: { taskId },
      runner: async (job) => {
        const started = Date.now();
        for (;;) {
          const data = await this.arkcli.genGet(taskId, saveTo);
          // gen get 的 status 可能是字符串，也可能是 { phase } 对象
          const raw = data.status !== undefined ? data.status : (data.data && data.data.status);
          const status = typeof raw === 'string' ? raw : (raw && raw.phase) || 'unknown';
          this._patch(job, { meta: { ...job.meta, remoteStatus: status } });
          if (status === 'succeeded') return data;
          if (status === 'failed' || status === 'cancelled') {
            throw new Error(data.error || `远端任务状态: ${status}`);
          }
          if (Date.now() - started > this.maxPollMs) {
            throw new Error('轮询超时，任务仍未完成');
          }
          await new Promise((r) => setTimeout(r, this.pollIntervalMs));
        }
      },
    });
  }

  _patch(job, patch) {
    Object.assign(job, patch, { updatedAt: Date.now() });
    this.emit('update', { ...job });
  }

  get(id) {
    return this.jobs.get(id) || null;
  }

  list() {
    return [...this.jobs.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((j) => ({ ...j }));
  }
}

module.exports = { TaskQueue };
