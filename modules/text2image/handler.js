module.exports = {
  async run(ctx, inputs, params) {
    if (!inputs.prompt) throw new Error('缺少输入: prompt');
    if (!params.model) throw new Error('缺少参数: model');
    const result = await ctx.arkcli.gen({
      model: params.model,
      prompt: inputs.prompt,
      modality: 'image',
      params: { size: params.size },
    });
    const localPath = result.local_path || (result.data && result.data.local_path);
    if (!localPath) throw new Error('文生图未返回 local_path');
    const asset = ctx.assets.register(localPath, { type: 'image', source: 'text2image' });
    return { image: asset };
  },
};
