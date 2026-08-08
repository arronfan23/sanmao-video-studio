module.exports = {
  async run(ctx, inputs, params) {
    if (!inputs.firstImage) throw new Error('缺少输入: 首帧图');
    if (!params.model) throw new Error('缺少参数: model');
    const toPath = (v) => (typeof v === 'string' ? v : v.path);
    // seedance 2.0 要求显式角色前缀：first:/last:
    const files = [{ role: 'first', path: toPath(inputs.firstImage) }];
    if (inputs.lastImage) files.push({ role: 'last', path: toPath(inputs.lastImage) });
    const submitted = await ctx.arkcli.gen({
      model: params.model,
      prompt: inputs.prompt || '让画面自然地动起来',
      modality: 'video',
      inputs: files,
      params: { resolution: params.resolution, duration: params.duration },
    });
    const taskId = submitted.task_id || (submitted.data && submitted.data.task_id);
    if (!taskId) throw new Error('图生视频未返回 task_id');

    const job = ctx.taskQueue.trackGenTask(taskId, { label: `图生视频 ${taskId}` });
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
    const asset = ctx.assets.register(localPath, { type: 'video', source: 'image2video' });
    return { video: asset };
  },
};
