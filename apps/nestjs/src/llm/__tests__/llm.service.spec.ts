import { Test, TestingModule } from '@nestjs/testing';
import { LlmService } from '../llm.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { Observable } from 'rxjs';
import { ChatCompletionChunk } from 'openai/resources/chat/completions';

// Mock OpenAI
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn(),
      },
    },
  }));
});

// 获取Mocked类型
const MockedOpenAI = OpenAI as jest.MockedClass<typeof OpenAI>;

describe('LlmService', () => {
  let service: LlmService;
  let mockedOpenAI: jest.Mocked<OpenAI>;

  const mockConfig = {
    apiKey: 'test-api-key',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-3.5-turbo',
    maxTokens: 1000,
    temperature: 0.7,
  };

  beforeEach(async () => {
    // 重置所有mock
    jest.clearAllMocks();

    // 设置mock实例
    const mockCreate = jest.fn();
    MockedOpenAI.mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    } as any));

    mockedOpenAI = new OpenAI() as jest.Mocked<OpenAI>;

    // 创建mock配置提供者
    const mockConfigProvider = {
      provide: 'CONFIGURATION(openai)',
      useValue: mockConfig,
    };

    // 创建 ConfigService mock
    const mockConfigService = {
      provide: ConfigService,
      useValue: {
        get: jest.fn((key: string) => {
          if (key === 'openai.apiKey') return mockConfig.apiKey;
          if (key === 'openai.baseURL') return mockConfig.baseURL;
          if (key === 'openai.model') return mockConfig.model;
          if (key === 'openai.maxTokens') return mockConfig.maxTokens;
          if (key === 'openai.temperature') return mockConfig.temperature;
          return undefined;
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmService,
        mockConfigProvider,
        mockConfigService,
      ],
    }).compile();

    service = module.get<LlmService>(LlmService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should initialize OpenAI client with baseURL', () => {
    expect(MockedOpenAI).toHaveBeenCalledWith({
      apiKey: mockConfig.apiKey,
      baseURL: mockConfig.baseURL,
    });
  });

  it('should initialize OpenAI client without baseURL when not provided', async () => {
    // 重置所有mock
    jest.clearAllMocks();

    const configWithoutBaseURL = {
      ...mockConfig,
      baseURL: undefined,
    };

    // 创建mock配置提供者
    const mockConfigProvider = {
      provide: 'CONFIGURATION(openai)',
      useValue: configWithoutBaseURL,
    };

    // 创建 ConfigService mock
    const mockConfigService = {
      provide: ConfigService,
      useValue: {
        get: jest.fn((key: string) => {
          if (key === 'openai.apiKey') return configWithoutBaseURL.apiKey;
          if (key === 'openai.baseURL') return configWithoutBaseURL.baseURL;
          if (key === 'openai.model') return configWithoutBaseURL.model;
          if (key === 'openai.maxTokens') return configWithoutBaseURL.maxTokens;
          if (key === 'openai.temperature') return configWithoutBaseURL.temperature;
          return undefined;
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmService,
        mockConfigProvider,
        mockConfigService,
      ],
    }).compile();

    const serviceWithoutBaseURL = module.get<LlmService>(LlmService);

    expect(MockedOpenAI).toHaveBeenCalledWith({
      apiKey: configWithoutBaseURL.apiKey,
    });

    expect(serviceWithoutBaseURL).toBeDefined();
  });

  describe('chatCompletion', () => {
    it('should call OpenAI with correct parameters and return response', async () => {
      const mockMessage = 'Hello, how are you?';
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'I am doing well, thank you for asking!',
            },
          },
        ],
      };

      const mockCreate = mockedOpenAI.chat.completions.create as jest.MockedFunction<typeof mockedOpenAI.chat.completions.create>;
      mockCreate.mockResolvedValue(mockResponse as any);

      const result = await service.chatCompletion(mockMessage);

      expect(mockCreate).toHaveBeenCalledWith({
        model: mockConfig.model,
        messages: [
          {
            role: 'user',
            content: mockMessage,
          },
        ],
        max_tokens: mockConfig.maxTokens,
        temperature: mockConfig.temperature,
      });

      expect(result).toBe('I am doing well, thank you for asking!');
    });

    it('should throw error when OpenAI returns no response', async () => {
      const mockMessage = 'Hello';
      const mockResponse = {
        choices: [],
      };

      const mockCreate = mockedOpenAI.chat.completions.create as jest.MockedFunction<typeof mockedOpenAI.chat.completions.create>;
      mockCreate.mockResolvedValue(mockResponse as any);

      await expect(service.chatCompletion(mockMessage)).rejects.toThrow(
        'No response received from OpenAI'
      );
    });

    it('should throw error when OpenAI API call fails', async () => {
      const mockMessage = 'Hello';
      const mockError = new Error('API Error');

      const mockCreate = mockedOpenAI.chat.completions.create as jest.MockedFunction<typeof mockedOpenAI.chat.completions.create>;
      mockCreate.mockRejectedValue(mockError);

      await expect(service.chatCompletion(mockMessage)).rejects.toThrow('API Error');
    });
  });

  describe('perspectiveConvertStream', () => {
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

    beforeEach(async () => {
      // 为每个测试设置包含 roles 配置的 ConfigService
      const moduleWithRoles: TestingModule = await Test.createTestingModule({
        providers: [
          LlmService,
          {
            provide: 'CONFIGURATION(openai)',
            useValue: mockConfig,
          },
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                if (key === 'roles.roles') return mockRoles;
                if (key === 'openai.apiKey') return mockConfig.apiKey;
                if (key === 'openai.baseURL') return mockConfig.baseURL;
                if (key === 'openai.model') return mockConfig.model;
                if (key === 'openai.maxTokens') return mockConfig.maxTokens;
                if (key === 'openai.temperature') return mockConfig.temperature;
                return undefined;
              }),
            },
          },
        ],
      }).compile();

      service = moduleWithRoles.get<LlmService>(LlmService);
    });

    it('should convert perspective from product-manager to developer successfully', async () => {
      const sourceRole = 'product-manager';
      const targetRole = 'developer';
      const content = '我们需要开发一个新功能来提升用户体验';

      const mockChunks = [
        { content: '从' },
        { content: '技术' },
        { content: '视角' },
        { content: '来看' },
      ];

      const mockStream = (async function* () {
        for (const chunk of mockChunks) {
          yield { choices: [{ delta: chunk }] };
        }
      })();

      const mockCreate = mockedOpenAI.chat.completions.create as jest.MockedFunction<typeof mockedOpenAI.chat.completions.create>;
      mockCreate.mockResolvedValue(mockStream as any);

      const [observable] = await service.perspectiveConvertStream(sourceRole, targetRole, content);

      const chunks: any[] = [];
      await new Promise<void>((resolve) => {
        observable.subscribe({
          next: (data) => {
            chunks.push(data);
          },
          complete: () => {
            resolve();
          },
        });
      });

      expect(chunks).toHaveLength(4);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: mockConfig.model,
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'system',
              content: expect.stringContaining('产品经理'),
            }),
            expect.objectContaining({
              role: 'user',
              content: expect.stringContaining(content),
            }),
          ]),
          stream: true,
        })
      );
    });

    it('should throw error when source role does not exist', async () => {
      const sourceRole = 'invalid-role';
      const targetRole = 'developer';
      const content = 'Test content';

      await expect(
        service.perspectiveConvertStream(sourceRole, targetRole, content)
      ).rejects.toThrow('源角色 "invalid-role" 不存在');
    });

    it('should throw error when target role does not exist', async () => {
      const sourceRole = 'product-manager';
      const targetRole = 'invalid-role';
      const content = 'Test content';

      await expect(
        service.perspectiveConvertStream(sourceRole, targetRole, content)
      ).rejects.toThrow('目标角色 "invalid-role" 不存在');
    });

    it('should throw error when role configuration is not found', async () => {
      // 创建一个没有 roles 配置的 service
      const moduleWithoutRoles: TestingModule = await Test.createTestingModule({
        providers: [
          LlmService,
          {
            provide: 'CONFIGURATION(openai)',
            useValue: mockConfig,
          },
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn(() => undefined),
            },
          },
        ],
      }).compile();

      const serviceWithoutRoles = moduleWithoutRoles.get<LlmService>(LlmService);

      await expect(
        serviceWithoutRoles.perspectiveConvertStream('product-manager', 'developer', 'Test')
      ).rejects.toThrow('角色配置未找到');
    });
  });
});