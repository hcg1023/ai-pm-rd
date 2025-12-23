import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { LlmModule } from '../llm.module';
import { LlmController } from '../llm.controller';
import { ConfigModule } from '@nestjs/config';
import OpenAI from 'openai';

// Mock OpenAI for integration testing
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn(),
      },
    },
  }));
});

const MockedOpenAI = OpenAI as jest.MockedClass<typeof OpenAI>;

describe('LlmModule E2E', () => {
  let app: INestApplication;
  let mockedOpenAI: jest.Mocked<OpenAI>;

  const mockConfig = {
    apiKey: 'test-api-key',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-3.5-turbo',
    maxTokens: 1000,
    temperature: 0.7,
  };

  const mockRoles = {
    'product-manager': {
      name: '产品经理',
      prompt: '## 产品经理视角\n关注用户需求和产品价值',
    },
    'developer': {
      name: '研发',
      prompt: '## 研发视角\n关注技术实现和代码质量',
    },
    'operations': {
      name: '运营',
      prompt: '## 运营视角\n关注用户增长和数据分析',
    },
    'manager': {
      name: '管理者',
      prompt: '## 管理者视角\n关注成本效益和团队协作',
    },
  };

  beforeAll(async () => {
    // Mock OpenAI responses
    const mockCreate = jest.fn();
    MockedOpenAI.mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    } as any));

    mockedOpenAI = new OpenAI() as jest.Mocked<OpenAI>;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [() => mockConfig, () => ({ roles: { roles: mockRoles } })],
        }),
        LlmModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({
      transform: true,
      whitelist: true,
    }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should have LlmController defined', () => {
    const controller = app.get<LlmController>(LlmController);
    expect(controller).toBeDefined();
  });

  describe('/llm/perspective-convert (POST)', () => {
    it('should validate required fields', async () => {
      const response = await request(app.getHttpServer())
        .post('/llm/perspective-convert')
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('message');
    });

    it('should validate sourceRole enum values', async () => {
      const response = await request(app.getHttpServer())
        .post('/llm/perspective-convert')
        .send({
          sourceRole: 'invalid-role',
          targetRole: 'developer',
          content: 'Test content',
        })
        .expect(400);

      expect(response.body).toHaveProperty('message');
    });

    it('should validate targetRole enum values', async () => {
      const response = await request(app.getHttpServer())
        .post('/llm/perspective-convert')
        .send({
          sourceRole: 'product-manager',
          targetRole: 'invalid-role',
          content: 'Test content',
        })
        .expect(400);

      expect(response.body).toHaveProperty('message');
    });

    it('should accept valid role values', async () => {
      const mockStream = (async function* () {
        yield { choices: [{ delta: { content: 'Test' } }] };
        yield { choices: [{ delta: { content: ' content' } }] };
      })();

      const mockCreate = mockedOpenAI.chat.completions.create as jest.MockedFunction<typeof mockedOpenAI.chat.completions.create>;
      mockCreate.mockResolvedValue(mockStream as any);

      const response = await request(app.getHttpServer())
        .post('/llm/perspective-convert')
        .send({
          sourceRole: 'product-manager',
          targetRole: 'developer',
          content: 'Test content',
        })
        .expect(201);

      // 验证返回的是 SSE 流
      expect(response.headers['content-type']).toContain('text/event-stream');
    });
  });
});
