module.exports = {
  async run(ctx, inputs, params) {
    if (!inputs.video) throw new Error('缺少输入: video');
    if (!params.model) throw new Error('缺少参数: model');
    const videoPath = typeof inputs.video === 'string' ? inputs.video : inputs.video.path;
    const submitted = await ctx.arkcli.gen({
      model: params.model,
      prompt: inputs.prompt || '保持参考视频的运动与风格，生成新的画面',
      modality: 'video',
      inputs: [{ role: 'ref', path: videoPath }],
      params: { resolution: params.resolution, duration: params.duration },
    });
    const taskId = submitted.task_id || (submitted.data && submitted.data.task_id);
    if (!taskId) throw new Error('视频生视频未返回 task_id');

    const job = ctx.taskQueue.trackGenTask(taskId, { label: `视频生视频 ${taskId}` });
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
    const asset = ctx.assets.register(localPath, { type: 'video', source: 'video2video' });
    return { video: asset };
  },
};
