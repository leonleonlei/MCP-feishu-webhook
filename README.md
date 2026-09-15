# feishu-bot-mcp

飞书群机器人 MCP Server — 通过 [Model Context Protocol](https://modelcontextprotocol.io/) 向飞书群发送消息。

基于飞书**自定义机器人 Webhook（v2）**实现，无需创建企业应用、无需申请 tenant_access_token，配置一个 Webhook 地址即可使用。

## 功能

| 工具名 | 功能 |
|--------|------|
| `send_text` | 发送纯文本消息（支持 @人） |
| `send_post` | 发送富文本消息（标题 + 段落 + 链接） |
| `send_card` | 发送交互卡片（标题 + Markdown 正文 + 按钮 + 配色） |
| `send_markdown` | 发送 Markdown 消息（内部转换为交互卡片实现） |
| `send_share_chat` | 分享群名片 |

> **关于 Markdown**：飞书自定义机器人**没有**原生的 markdown 消息类型（这点和钉钉不同）。本 Server 的 `send_markdown` 会自动把 Markdown 包装成交互卡片，用 `lark_md` 渲染，效果等同。

> **关于图片**：飞书自定义机器人 Webhook 没有任何图片上传接口，无法直接发送图片。如需发图，需另建飞书应用调用上传接口拿到 `image_key`。

## 环境变量

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `FEISHU_BOT_WEBHOOK` | 是 | 飞书机器人 Webhook 完整地址，形如 `https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |
| `FEISHU_BOT_SECRET` | 否 | 加签密钥（安全设置选择「签名校验」时启用） |

## 快速开始

```bash
git clone https://github.com/leonleonlei/MCP-feishu-webhook.git
cd MCP-feishu-webhook
npm install
node server.js
```

## MCP 客户端配置

```json
{
  "mcpServers": {
    "feishu-bot": {
      "command": "node",
      "args": ["/path/to/MCP-feishu-webhook/server.js"],
      "env": {
        "FEISHU_BOT_WEBHOOK": "https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx",
        "FEISHU_BOT_SECRET": "your-secret"
      }
    }
  }
}
```

## 使用示例

配置完成后，AI 助手可以直接调用工具：

- "给飞书群发一条消息：今天下午3点开会"
- "发一张飞书卡片，标题'系统告警'，红色主题，内容是服务不可用"
- "把这个周报以 Markdown 格式发到飞书群"

## 获取飞书机器人凭证

1. 打开飞书群 → 设置 → 群机器人 → 添加机器人 → **自定义机器人**
2. 填写名称，安全设置勾选「**签名校验**」，复制密钥（即 `FEISHU_BOT_SECRET`）
3. 复制生成的 Webhook 地址（即 `FEISHU_BOT_WEBHOOK`）

> 安全设置也可选「自定义关键词」，此时无需配置 `FEISHU_BOT_SECRET`，但消息内容必须包含设定关键词才能发送成功。

## 与钉钉版的差异

飞书和钉钉的自定义机器人 API 是两套完全不同的体系，主要差异：

| 维度 | 钉钉 | 飞书 |
|------|------|------|
| 签名位置 | URL 查询参数 | **JSON body 根层级** |
| 签名字符串 | `timestamp\nsecret` | `timestamp\nsecret`（相同） |
| 时间戳单位 | 毫秒 | **秒** |
| 成功判据 | `errcode === 0` | **`code === 0`** |
| 消息类型字段 | `msgtype` | **`msg_type`** |
| 卡片消息 | `msgtype: actionCard` | `msg_type: "interactive"` + **顶层 `card` 字段** |
| 原生 Markdown | 有（`msgtype: markdown`） | **无**，需用卡片 `lark_md` |
| 图片 | 可用 Markdown 嵌图片 URL | **不支持**（无上传接口） |
| 频率限制 | 20 次/分钟 | **100 次/分钟，5 次/秒** |

## 技术细节

- 基于 `@modelcontextprotocol/sdk` 构建
- 使用 stdio 传输协议
- Node.js >= 18
- ESM 模块

## License

MIT
