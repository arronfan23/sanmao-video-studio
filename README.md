# Sanmao Video Studio

<p align="center"><img src="src/renderer/assets/logo.png" width="120" alt="Sanmao Video Studio" /></p>

基于火山引擎 arkcli 的模块化视频工作流客户端（Windows，可打包 MSI）。

## 安装（终端用户）

1. 前置条件：安装 [Node.js LTS](https://nodejs.org/)（arkcli 通过 npm 分发）
2. 下载最新 Release 的 `Sanmao Video Studio-Setup-x.y.z.msi` 并安装
3. 首次启动会进入装机引导：安装 arkcli → SSO 登录火山引擎 → 配置 LLM API Key
   （未签名的安装包可能触发 SmartScreen 提示，选择「仍要运行」即可）

系统要求：Windows 10 1803+ / Windows 11（Win11 自动启用亚克力磨砂效果）

## v0.2 功能

- 画布式工作流编辑器：从模块面板拖入节点、端口连线（类型校验 / 单入线 / 禁环）、
  右侧参数面板按 module.json 自动渲染、运行时节点状态回显（蓝=运行中 / 绿=成功 / 红=失败）
- 设置页双分区：OpenAI 兼容 LLM 服务（Base URL + API Key + 端点模型列表拉取，
  内置火山方舟 / DeepSeek / Kimi / GLM / Qwen / MiniMax / MiMo / 自定义中转预设，
  Key 走 safeStorage/DPAPI 加密存储）+
  arkcli 环境卡片（版本 / 登录态 / 一键 SSO 登录 / 安装向导 / 重新检测）
- 首次启动 Onboarding：安装 arkcli -> SSO 登录 -> 配置 API Key，逐步引导可跳过
- 双通道凭据：生成类（图/视频）走 arkcli 登录态；文本类（提示词润色）走 API Key 直连任意 OpenAI 兼容端点
- 工作流持久化：画布内容（节点 / 位置 / 连线 / 参数 / 字面量）命名保存、重开恢复

## 架构

```
src/main/            Electron 主进程
  core/
    arkcli-bridge.js     arkcli 命令桥接（spawn + JSON 解析），所有 arkcli 调用的唯一入口
    llm-api.js           OpenAI 兼容 LLM 直连客户端（仅文本类调用，Key 不出主进程）
    credential-store.js  API Key 加密存储（safeStorage / DPAPI）
    module-registry.js   模块注册中心，扫描 modules/ 自动加载
    workflow-engine.js   工作流引擎，拓扑排序 + 上下游映射 + 节点级状态事件
    task-queue.js        异步任务队列，轮询 arkcli gen get 到终态
    asset-store.js       素材库（产物登记与索引）
    project-store.js     项目 / 运行历史 / 工作流画布持久化
  ipc.js             渲染进程 IPC 路由
src/shared/graph.js  画布图逻辑（类型校验 / 环检测 / 就绪校验 / pipeline 转换，前后端共用）
src/renderer/        客户端界面（原生 HTML/JS）
  canvas.js          画布编辑器
  app.js             应用外壳 / 设置页 / Onboarding
modules/             工作流模块，一个目录一个能力
  prompt-assist/     提示词助手（API Key 直连 OpenAI 兼容 chat/completions）
  text2image/        文生图（seedream，同步）
  text2video/        文生视频（seedance，异步轮询）
  image2video/       图生视频（I2V）
  video-merge/       合成导出（占位，后续接 ffmpeg / 剪映草稿）
```

## 新增一个模块

在 `modules/` 下建目录，放两个文件即可，无需改主程序：

- `module.json`：声明 id / name / inputs / outputs / params（`type: "model"` 的 params 会自动从 `arkcli resources list` 拉候选）
- `handler.js`：导出 `async run(ctx, inputs, params)`，`ctx` 提供 `arkcli` / `taskQueue` / `assets` / `projects`

## 开发

```bash
npm install
npm start        # 启动客户端
npm test         # 注册中心 + 引擎单测
```

## 打包 MSI

```bash
npm run dist     # 输出 release/Sanmao Video Studio-Setup-x.y.z.msi
```

## 发布自动更新

更新通道是一个静态托管的 `version.json`（地址常量：`src/main/core/updater.js` 顶部 `UPDATE_FEED_URL`）：

```json
{
  "version": "0.2.0",
  "msiUrl": "https://你的托管地址/Sanmao-Video-Studio-Setup-0.2.0.msi",
  "notes": "更新内容..."
}
```

发版流程：改 `package.json` 版本 -> `npm run dist` 出 MSI -> 把 MSI 和 version.json
传到同一托管位置（GitHub Releases / Gitee / TOS 均可）。客户端「检查更新」会比对版本号，
有新版本则确认后自动下载并静默安装。

## 已知边界（P1 backlog）

- 画布增强：撤销重做 / 缩放 / 小地图 / 自动布局 / 节点复制粘贴
- arkcli 应用内一键静默安装（v0.2 为半自动引导）
- 多 profile 管理界面
- video-merge 的真实合成（ffmpeg / 剪映草稿）
