// 框架期占位实现：校验输入并返回片段清单。
// 后续接入 ffmpeg concat 或 pyJianYingDraft 生成剪映草稿。
module.exports = {
  async run(ctx, inputs, params) {
    const videos = Array.isArray(inputs.videos) ? inputs.videos : [inputs.videos].filter(Boolean);
    if (videos.length === 0) throw new Error('缺少输入: videos');
    // 占位实现（F13 接 ffmpeg / 剪映草稿）：记录输入段数，先透传第一段
    return {
      merged: videos[0],
      note: `合成占位：已收到 ${videos.length} 段素材，真实合成待后续版本`,
    };
  },
};
