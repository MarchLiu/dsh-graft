# dsh-graft 🌱

**嫁接**：把一段会话变成另一段会话的养分。DeepSeek Harness 插件，双半区：

- **Node 半区**（6 个 agent 工具）：切片读取 / 导出 / 原生分叉 / 转发；
- **Browser 半区**（`client.js`）：会话页面里的 🌱 嫁接模式——鼠标点选轮次，
  一键把选中内容发送到另一个会话或全新会话。

## 网页端：嫁接模式

1. 会话标题栏点 **「🌱 嫁接」** 进入选择模式（按钮显示已选计数）；
2. 每个已完成轮次末尾出现 **「☑ 轮次 #N」** 复选框，点选要嫁接的轮次；
3. 底部浮条选择目标：任一已有会话，或 **「＋ 新会话（当前工作区）」**；
4. 点 **「发送嫁接」**——选中内容打包成带 `<graft source=…>` 标注的一条消息
   注入目标会话（发往新会话时自动在工作区开新会话并跳转过去）。

实现：`client.js` 手写为 client module 系统的闭包工厂格式，零构建步骤；
只依赖 shell 预载的 `react`，通过 package.json 的 `dsh.client` 声明被宿主
扫描加载，支持 client-module HMR（改完无需重装）。

## 工具

| 工具 | 作用 |
|---|---|
| `graft_sessions` | 列出会话（id / 标题 / cwd / 更新时间 / 血统），用于选取 id（支持无歧义前缀） |
| `graft_search` | 跨会话全文搜索（`session.search`） |
| `graft_read` | 读取会话日志切片，参数：`fromSeq`/`toSeq`/`search`/`role`/`last` |
| `graft_export` | 同样的切片导出为 `.md` / `.json`（默认 `$DSH_HOME/exports/`） |
| `graft_fork` | 在轮次边界分叉新会话（宿主原生 `session.fork`） |
| `graft_forward` | 切片 → 打包 → `session.prompt` 注入目标会话；`newSession.cwd` 可顺手建新会话 |

## 设计

零依赖、纯 Node 半区（`inject: ['tools', 'apiProxy']`）。所有读写都走宿主
`ctx.apiProxy` 的 `session.*` RPC——不直接碰磁盘上的 `session.jsonl(.zstd)`，
因此对冷会话、热会话、zstd 压缩都天然正确，也不会绕过宿主的边界检查。

## 安装

```sh
# 从 npm 安装
dsh plugin --profile web add dsh-graft

# 或本地开发目录安装
dsh plugin --profile web add /Users/mars/jobs/dsh-graft
```

安装后重启宿主（client 模块图在启动时扫描）。已装的情况下改了源码，
把改动文件同步进 profile 的 `node_modules/dsh-graft/` 即可，HMR 会热重载。

## 典型用法

```
graft_read   { session: "7314db70", fromSeq: 7, toSeq: 60 }   # 预览片段
graft_export { session: "7314db70", search: "fork", role: "assistant" }
graft_forward{ session: "7314db70", newSession: { cwd: "/tmp/x", title: "继续讨论" },
               instruction: "基于这份记录继续设计" }
graft_fork   { session: "7314db70", atSeq: 88 }
```

## License

MIT
