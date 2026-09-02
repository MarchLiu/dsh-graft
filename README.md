# dsh-graft 🌱

**嫁接**：把一段会话变成另一段会话的养分。DeepSeek Harness 插件，提供三层能力：

1. **切片读取 / 导出** — 读取一个会话日志的任意片段（seq 区间 / 角色 / 关键词过滤），渲染为可读 transcript 或导出为 Markdown / JSON 文件；
2. **原生分叉** — 在任意已完成轮次边界 `session.fork` 出一个新会话（继承 cwd、模型与 parentSession 血统）；
3. **转发 / 嫁接** — 把选定片段打包成一条带来源标注的 `<graft>` 消息，转发给另一个已有会话，或先建新会话再注入；目标 Agent 把它当上下文继续干活。

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
dsh plugin --profile web add @mars.liu/dsh-graft

# 或本地开发目录安装
dsh plugin --profile web add /Users/mars/jobs/dsh-graft
```

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
