module.exports = {
  async run(ctx, inputs, params) {
    if (!inputs.prompt) throw new Error('缺少输入: prompt');
    if (!params.model) throw new Error('缺少参数: model');
    const submitted = await ctx.arkcli.gen({
      model: params.model,
      prompt: inputs.prompt,
      modality: 'video',
      params: {
        resolution: params.resolution,
        duration: params.duration,
        ratio: params.ratio,
      },
    });
    const taskId = submitted.task_id || (submitted.data && submitted.data.task_id);
    if (!taskId) throw new Error('文生视频未返回 task_id');

    // 异步任务：交给队列轮询到终态，本节点等待结果
    const job = ctx.taskQueue.trackGenTask(taskId, { label: `文生视频 ${taskId}` });
    const finalData = await new Promise((resolve, reject) => {
      const onUpdate = (j) => {
        if (j.id !== job.id) return;
        if (j.status === 'succeeded') { cleanup(); resolve(j.result); }
        if (j.status === 'failed') { cleanup(); reject(new Error(j.error)); }
      };
      const cleanup = () => ctx.taskQueue.off('update', onUpdate);
      ctx.taskQueue.on('update', onUpdate);
    });

    const localPath = finalData.local_path || (finalData.data && finalData.data.local_path);
    if (!localPath) throw new Error('任务完成但未获得本地产物路径');
    const asset = ctx.assets.register(localPath, { type: 'video', source: 'text2video' });
    return { video: asset };
  },
};
