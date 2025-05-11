// src/index.js - 使用 OpenAI SDK 格式调用 DeepSeek API 的 Worker

import { createYoga } from 'graphql-yoga';
import { makeExecutableSchema } from '@graphql-tools/schema';

// GraphQL Schema 定义
const typeDefs = `
  type Query {
    ping: String
  }
  
  type Message {
    role: String!
    content: String!
  }
  
  type ChatResponse {
    messages: [Message!]!
    conversationId: String
  }
  
  type Mutation {
    chatWithAI(message: String!, conversationId: String, systemPrompt: String): ChatResponse
  }
`;

// Resolver 函数实现
const resolvers = {
  Query: {
    ping: () => 'hello, xiaopangza test',
  },
  Mutation: {
    chatWithAI: async (_, args, context) => {
      try {
        const { message, conversationId, systemPrompt = "You are a helpful assistant." } = args;
        const { env } = context;

        // 获取环境变量
        const API_KEY = context.DEEPSEEK_API_KEY;
        const BASE_URL = env.DEEPSEEK_API_URL || 'https://api.deepseek.com';
        const MODEL = env.DEEPSEEK_MODEL || 'deepseek-chat';

        console.log('API configuration:', {
          baseUrl: BASE_URL,
          model: MODEL,
          hasKey: !!API_KEY,
          messageLength: message.length,
          hasSystemPrompt: !!systemPrompt
        });

        if (!API_KEY) {
          throw new Error('API 密钥未设置 (DEEPSEEK_API_KEY)');
        }

        // 准备消息数组
        const messages = [];

        // 添加系统提示
        if (systemPrompt) {
          messages.push({ role: 'system', content: systemPrompt });
        }

        // 添加用户消息
        messages.push({ role: 'user', content: message });

        // 使用 OpenAI SDK 风格的请求格式
        const requestData = {
          model: MODEL,
          messages: messages,
          temperature: 0.7,
          max_tokens: 2000,
          stream: false,
        };

        console.log('Sending request to DeepSeek API:', JSON.stringify({
          ...requestData,
          messages: requestData.messages.map(m => ({ ...m, content: m.content.substring(0, 20) + '...' }))
        }));

        // 构建 API URL
        const apiUrl = `${BASE_URL}/v1/chat/completions`;

        // 调用 DeepSeek API
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`,
          },
          body: JSON.stringify(requestData),
        });

        console.log('API response status:', response.status);

        // 检查错误响应
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`API error (${response.status}):`, errorText);

          // 特殊处理 Insufficient Balance 错误
          if (errorText.includes('Insufficient Balance')) {
            throw new Error('API 账户余额不足，请充值后再试');
          }

          throw new Error(`API 响应错误 (${response.status}): ${errorText}`);
        }

        // 解析 API 响应
        const data = await response.json();
        console.log('API response structure:', JSON.stringify({
          id: data.id,
          object: data.object,
          created: data.created,
          model: data.model,
          hasChoices: !!data.choices,
          choicesLength: data.choices?.length || 0,
          firstChoice: data.choices?.[0] ? Object.keys(data.choices[0]) : null
        }));

        // 检查响应格式，确保兼容 OpenAI SDK 的响应格式
        if (!data.choices || data.choices.length === 0 || !data.choices[0].message) {
          console.error('Unexpected API response format:', JSON.stringify(data));
          throw new Error('DeepSeek API 返回了意外的响应格式');
        }

        // 检查是否有错误消息表明余额不足
        const assistantMessage = data.choices[0].message.content;
        if (data.choices[0].finish_reason === false && assistantMessage.includes('Insufficient Balance')) {
          throw new Error('API 账户余额不足，请充值后再试');
        }

        // 生成会话 ID
        const newConversationId = conversationId || `session-${Date.now()}`;

        // 返回成功响应
        return {
          messages: [
            { role: 'user', content: message },
            { role: 'assistant', content: assistantMessage }
          ],
          conversationId: newConversationId,
        };
      } catch (error) {
        console.error('Error in chatWithAI resolver:', error);
        throw error; // 重新抛出错误让 GraphQL 处理
      }
    },
  },
};

// 创建 GraphQL schema
const schema = makeExecutableSchema({
  typeDefs,
  resolvers,
});

// 创建 Yoga GraphQL 处理器
const yoga = createYoga({
  schema,
  graphqlEndpoint: '/',
  landingPage: false,
  cors: {
    origin: '*',
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['POST', 'GET', 'OPTIONS'],
    credentials: true,
  },
  graphiql: true,
});

// 更好的错误处理和格式化
const formatError = (error) => {
  console.error('GraphQL error:', error);

  // 确定错误消息
  let message = error.message || 'An unknown error occurred';

  // 检查是否为余额不足错误
  if (message.includes('余额不足') || message.includes('Insufficient Balance')) {
    return {
      message: '🚫 API 账户余额不足，请充值后再试',
      extensions: {
        code: 'INSUFFICIENT_BALANCE',
        ...error.extensions,
      }
    };
  }

  // 其他错误的格式化
  return {
    message,
    extensions: {
      ...(error.extensions || {}),
      timestamp: new Date().toISOString(),
    }
  };
};

// Worker 请求处理函数
export default {
  async fetch(request, env, ctx) {
    try {
      // 处理 CORS 预检请求
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, Apollo-Require-Preflight',
            'Access-Control-Max-Age': '86400',
          },
        });
      }

      // 处理 GraphQL 请求
      const response = await yoga.fetch(request, env, ctx);

      // 确保 CORS 头被添加到响应中
      const headers = new Headers(response.headers);
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      console.error('Unhandled error in fetch:', error);

      // 格式化错误响应
      let errorMessage = error.message || 'Unknown server error';
      let errorCode = 'SERVER_ERROR';

      // 检查特殊错误类型
      if (errorMessage.includes('余额不足') || errorMessage.includes('Insufficient Balance')) {
        errorMessage = '🚫 API 账户余额不足，请充值后再试';
        errorCode = 'INSUFFICIENT_BALANCE';
      }

      // 返回错误响应
      return new Response(
        JSON.stringify({
          errors: [{
            message: errorMessage,
            extensions: {
              code: errorCode,
              timestamp: new Date().toISOString()
            }
          }]
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          },
        }
      );
    }
  },
};