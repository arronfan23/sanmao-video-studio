const assert = require('assert');
const { TaskQueue } = require('../src/main/core/task-queue');

(async () => {
  // gen get 的 status 是 { phase } 对象（真实返回形态），必须正确识别终态
  const fakeArkcli = {
    calls: 0,
    async genGet() {
      this.calls++;
      if (this.calls < 2) return { status: { phase: 'running' } };
      return { status: { phase: 'succeeded' }, local_path: '/tmp/x.mp4' };
    },
  };
  const queue = new TaskQueue({ arkcli: fakeArkcli, pollIntervalMs: 10 });
  const job = queue.trackGenTask('cgt-test', {});
  await new Promise((resolve, reject) => {
    queue.on('update', (j) => {
      if (j.id !== job.id) return;
      if (j.status === 'succeeded') resolve();
      if (j.status === 'failed') reject(new Error(j.error));
    });
  });
  assert.strictEqual(job.result.local_path, '/tmp/x.mp4');

  // 字符串形态也要兼容
  const fake2 = { async genGet() { return { status: 'failed', error: '远端失败' }; } };
  const queue2 = new TaskQueue({ arkcli: fake2, pollIntervalMs: 10 });
  const job2 = queue2.trackGenTask('cgt-test2', {});
  await new Promise((resolve) => {
    queue2.on('update', (j) => {
      if (j.id === job2.id && j.status === 'failed') resolve();
    });
  });
  assert(job2.error.includes('远端失败'));

  console.log('taskqueue.test.js 通过：phase 对象状态识别 / 字符串兼容 / 失败传播正常');
})().catch((e) => { console.error(e); process.exit(1); });
