const SYSTEM = '你是视频生成提示词专家。把用户的粗略创意改写成适合即梦 seedream/seedance 模型的中文提示词，包含主体、动作、场景、镜头语言、光线与风格，只输出提示词本身，不要解释。';

// 双模式提示词模块（PM 定案 v0.2.0）：
// - 原文直出：手写内容原样输出，不调 LLM，无 API Key 也能跑
// - AI 润色：走设置页的 LLM 端点润色；prompt 参数非空时视为用户已编辑的最终稿，直接输出
module.exports = {
  async run(ctx, inputs, params) {
    const text = (inputs.brief || params.brief || '').trim();

    if (params.mode === 'AI 润色') {
      if (params.prompt && params.prompt.trim()) {
        return { prompt: params.prompt.trim() };
      }
      if (!text) throw new Error('请填写提示词内容，或从上游连线创意描述');
      const style = params.style ? `，整体风格偏向 ${params.style}` : '';
      const result = await ctx.llmApi.chat({
        prompt: `创意：${text}${style}`,
        system: SYSTEM,
        model: params.model || undefined,
      });
      if (!result.text) throw new Error('LLM 未返回内容');
      return { prompt: result.text.trim() };
    }

    // 原文直出
    if (!text) throw new Error('请填写提示词内容，或从上游连线');
    return { prompt: text };
  },
};
