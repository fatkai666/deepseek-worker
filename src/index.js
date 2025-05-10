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
    chatWithAI(message: String!, conversationId: String): ChatResponse
  }
`;

// Resolver 函数实现
const resolvers = {
  Query: {
    ping: () => 'pong',
  },
  Mutation: {
    chatWithAI: async (_, { message, conversationId }, { request }) => {
      // 从环境变量获取 API 配置
      const AI_API_KEY = request.cf.env.AI_API_KEY;
      const AI_API_URL = request.cf.env.AI_API_URL;

      try {
        // 准备请求数据
        const requestData = {
          messages: [{ role: 'user', content: message }],
        };

        // 如果有会话 ID，添加到请求中
        if (conversationId) {
          requestData.conversationId = conversationId;
        }

        // 调用 AI API
        const response = await fetch(AI_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${AI_API_KEY}`,
          },
          body: JSON.stringify(requestData),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`AI API 响应错误 (${response.status}): ${errorText}`);
        }

        const data = await response.json();

        // 返回格式化的响应
        return {
          messages: [
            { role: 'user', content: message },
            { role: 'assistant', content: data.choices[0].message.content }
          ],
          conversationId: data.conversationId || null,
        };
      } catch (error) {
        console.error('Error calling AI API:', error);
        throw new Error(`调用 AI API 时出错: ${error.message}`);
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
});

// Worker 请求处理函数
export default {
  async fetch(request, env, ctx) {
    // 将环境变量添加到请求对象中
    request.cf = request.cf || {};
    request.cf.env = env;

    // 处理 CORS (允许跨域请求)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // 处理 GraphQL 请求
    return yoga.fetch(request, env, ctx);
  },
};