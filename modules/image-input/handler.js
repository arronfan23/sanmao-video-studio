module.exports = {
  async run(ctx, inputs, params) {
    if (!params.file) throw new Error('请先选择图片文件');
    // 素材库只存生成产物：导入模块只传引用，不登记入库
    const path = require('path');
    return { image: { path: params.file, name: path.basename(params.file), type: 'image' } };
  },
};
