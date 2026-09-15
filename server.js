#!/usr/bin/env node
/**
 * 飞书机器人 MCP Server (Node.js)
 *
 * 通过 MCP 协议向飞书群发送消息。
 * 基于飞书自定义机器人 Webhook（v2），无需创建应用、无需 tenant_access_token。
 *
 * 环境变量:
 *   FEISHU_BOT_WEBHOOK — 飞书机器人 Webhook 地址或 hook_id (必填)
 *   FEISHU_BOT_SECRET  — 飞书机器人签名密钥 (可选，用于加签验证)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import crypto from 'node:crypto';

// ── 环境变量 ──
const RAW_WEBHOOK = (process.env.FEISHU_BOT_WEBHOOK || '').trim();
const SECRET = (process.env.FEISHU_BOT_SECRET || '').trim();

if (!RAW_WEBHOOK) {
  console.error('[feishu-mcp] FEISHU_BOT_WEBHOOK 未设置');
  process.exit(1);
}

// 允许传入完整 Webhook 地址，或只传 hook_id
const WEBHOOK_URL = RAW_WEBHOOK.startsWith('http')
  ? RAW_WEBHOOK
  : `https://open.feishu.cn/open-apis/bot/v2/hook/${RAW_WEBHOOK}`;

// ── 签名计算 ──
function buildSignature() {
  if (!SECRET) return {};
  const timestamp = String(Math.floor(Date.now() / 1000));
  const stringToSign = `${timestamp}\n${SECRET}`;
  const sign = crypto.createHmac('sha256', stringToSign).update('').digest('base64');
  return { timestamp, sign };
}

// ── HTTP 请求 ──
async function sendToFeishu(body) {
  const payload = { ...buildSignature(), ...body };
  const resp = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => ({}));
  if (data.code !== 0 && data.StatusCode !== 0) {
    throw new Error(`飞书 API 返回错误: ${data.msg || data.StatusMessage || '未知错误'} (code=${data.code ?? data.StatusCode ?? 'N/A'})`);
  }
  return 'ok';
}

// ── MCP Server ──
const server = new McpServer({
  name: 'feishu-mcp',
  version: '1.0.0',
});

// send_text
server.tool(
  'send_text',
  '向飞书群发送纯文本消息',
  { content: z.string().describe('消息文本内容') },
  async (args) => {
    const content = args.content || '';
    if (!content.trim()) throw new Error('消息内容不能为空');
    await sendToFeishu({ msg_type: 'text', content: { text: content } });
    return { content: [{ type: 'text', text: '文本消息已发送' }] };
  }
);

// send_markdown
server.tool(
  'send_markdown',
  '向飞书群发送 Markdown 格式消息（通过交互卡片的 lark_md 渲染）',
  {
    title: z.string().optional().describe('卡片标题（可选）'),
    text: z.string().describe('Markdown 格式的消息内容'),
    template: z
      .enum(['blue', 'wathet', 'turquoise', 'green', 'yellow', 'orange', 'red', 'carmine', 'violet', 'purple', 'indigo', 'grey'])
      .optional()
      .describe('标题栏颜色，默认 blue'),
  },
  async (args) => {
    const { title, text, template = 'blue' } = args;
    if (!text || !text.trim()) throw new Error('消息内容不能为空');
    const card = {
      config: { wide_screen_mode: true },
      elements: [{ tag: 'div', text: { tag: 'lark_md', content: text } }],
    };
    if (title) {
      card.header = { title: { tag: 'plain_text', content: title }, template };
    }
    await sendToFeishu({ msg_type: 'interactive', card });
    return { content: [{ type: 'text', text: 'Markdown 消息已发送' }] };
  }
);

// send_card
server.tool(
  'send_card',
  '向飞书群发送交互卡片消息。支持标题栏（可配色）、Markdown 正文、底部按钮。',
  {
    title: z.string().describe('卡片标题'),
    content: z.string().describe('卡片正文（Markdown 格式）'),
    template: z
      .enum(['blue', 'wathet', 'turquoise', 'green', 'yellow', 'orange', 'red', 'carmine', 'violet', 'purple', 'indigo', 'grey'])
      .optional()
      .describe('标题栏颜色，默认 blue'),
    subtitle: z.string().optional().describe('标题栏副标题（可选）'),
    buttons: z
      .array(z.object({ text: z.string(), url: z.string() }))
      .optional()
      .describe('底部按钮列表，每项含 text 和 url（最多 5 个）'),
  },
  async (args) => {
    const { title, content, template = 'blue', subtitle, buttons } = args;
    if (!title || !title.trim()) throw new Error('卡片标题不能为空');
    if (!content || !content.trim()) throw new Error('卡片内容不能为空');
    const header = { title: { tag: 'plain_text', content: title }, template };
    if (subtitle) header.subtitle = { tag: 'plain_text', content: subtitle };
    const elements = [{ tag: 'div', text: { tag: 'lark_md', content } }];
    if (buttons && buttons.length) {
      elements.push({
        tag: 'action',
        actions: buttons.slice(0, 5).map((b) => ({
          tag: 'button',
          text: { tag: 'lark_md', content: b.text },
          url: b.url,
          type: 'default',
        })),
      });
    }
    await sendToFeishu({
      msg_type: 'interactive',
      card: { config: { wide_screen_mode: true }, header, elements },
    });
    return { content: [{ type: 'text', text: '交互卡片消息已发送' }] };
  }
);

// send_post
server.tool(
  'send_post',
  '向飞书群发送富文本消息。按段落组织，每个段落是一组行内元素，支持 text、a、at 三种标签。',
  {
    title: z.string().optional().describe('富文本标题（可选）'),
    paragraphs: z
      .array(
        z.array(
          z.object({
            tag: z.enum(['text', 'a', 'at']).describe('元素类型'),
            text: z.string().optional().describe('文本内容（tag=text 或 a 时必填）'),
            href: z.string().optional().describe('链接地址（tag=a 时必填）'),
            user_id: z.string().optional().describe('用户 open_id（tag=at 时必填）'),
            user_name: z.string().optional().describe('显示名称（tag=at 时可选）'),
          })
        )
      )
      .describe('段落数组：外层每个元素是一个段落，内层是该段落中的行内元素列表'),
  },
  async (args) => {
    const { title, paragraphs } = args;
    if (!paragraphs || !paragraphs.length) throw new Error('消息内容不能为空');
    const content = paragraphs.map((line) =>
      line.map((el) => {
        if (el.tag === 'a') {
          if (!el.text || !el.href) throw new Error('链接元素需要同时提供 text 和 href');
          return { tag: 'a', text: el.text, href: el.href };
        }
        if (el.tag === 'at') {
          if (!el.user_id) throw new Error('@元素需要提供 user_id');
          return { tag: 'at', user_id: el.user_id, user_name: el.user_name || '' };
        }
        return { tag: 'text', text: el.text || '' };
      })
    );
    const post = { zh_cn: { title: title || '', content } };
    await sendToFeishu({ msg_type: 'post', content: { post } });
    return { content: [{ type: 'text', text: '富文本消息已发送' }] };
  }
);

// send_image
server.tool(
  'send_image',
  '向飞书群发送图片。注意：需提供已通过飞书应用上传接口获得的 image_key。',
  { imageKey: z.string().describe('图片的 image_key（形如 img_xxxxx）') },
  async (args) => {
    const imageKey = args.imageKey || '';
    if (!imageKey.trim()) throw new Error('image_key 不能为空');
    await sendToFeishu({ msg_type: 'image', content: { image_key: imageKey } });
    return { content: [{ type: 'text', text: '图片消息已发送' }] };
  }
);

// send_share_chat
server.tool(
  'send_share_chat',
  '向飞书群发送群名片分享卡片。',
  { shareChatId: z.string().describe('被分享群的 open_chat_id（形如 oc_xxxxx）') },
  async (args) => {
    const shareChatId = args.shareChatId || '';
    if (!shareChatId.trim()) throw new Error('share_chat_id 不能为空');
    await sendToFeishu({ msg_type: 'share_chat', content: { share_chat_id: shareChatId } });
    return { content: [{ type: 'text', text: '群名片已发送' }] };
  }
);

// ── 启动 ──
console.error('[feishu-mcp] Starting...');
console.error('[feishu-mcp] Node: ' + process.version);
console.error('[feishu-mcp] Webhook: ' + WEBHOOK_URL.replace(/hook\/.*$/, 'hook/***'));
console.error('[feishu-mcp] SECRET: ' + (SECRET ? '***set***' : 'NOT SET'));

process.on('uncaughtException', (err) => {
  console.error('[feishu-mcp] FATAL: ' + err.message + '\n' + err.stack);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[feishu-mcp] FATAL(unhandled): ' + String(reason));
  process.exit(1);
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[feishu-mcp] Server started');
