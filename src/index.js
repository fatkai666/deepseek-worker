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
    chatWithAI: async (_, args, context) => {
      const { message, conversationId } = args;
      const { request, env } = context;

      // 从环境变量获取 API 配置
      const AI_API_KEY = env.AI_API_KEY;
      const AI_API_URL = env.AI_API_URL;

      try {
        // 准备请求数据
        const requestData = {
          messages: [{ role: 'user', content: message }],
        };

        // 如果有会话 ID，添加到请求中
        if (conversationId) {
          requestData.conversationId = conversationId;
        }

        console.log('Sending request to AI API:', JSON.stringify(requestData));

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
          console.error(`AI API error (${response.status}): ${errorText}`);
          throw new Error(`AI API 响应错误 (${response.status}): ${errorText}`);
        }

        const data = await response.json();
        console.log('AI API response:', JSON.stringify(data));

        // 确保数据结构符合预期
        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
          console.error('Unexpected API response format:', JSON.stringify(data));
          throw new Error('AI API 返回了意外的响应格式');
        }

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
        throw new Error(`调用 AI API 时出错: ${error.message || '未知错误'}`);
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
  graphiql: true, // 启用 GraphiQL 界面以便调试
});

// Worker 请求处理函数
export default {
  async fetch(request, env, ctx) {
    // 打印请求信息以便调试
    console.log('Received request:', {
      method: request.method,
      url: request.url,
      headers: Object.fromEntries([...request.headers])
    });

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

    try {
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
      console.error('Error handling request:', error);

      // 返回格式化的错误响应
      return new Response(
        JSON.stringify({
          errors: [{ message: error.message || '未知错误' }]
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