import { Test, TestingModule } from '@nestjs/testing';
import { LlmController } from '../llm.controller';
import { LlmService } from '../llm.service';

// Mock LlmService
const mockLlmService = {
  chatCompletion: jest.fn(),
  chatCompletionStream: jest.fn(),
  perspectiveConvertStream: jest.fn(),
};

describe('LlmController', () => {
  let controller: LlmController;
  let service: jest.Mocked<LlmService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LlmController],
      providers: [
        {
          provide: LlmService,
          useValue: mockLlmService,
        },
      ],
    }).compile();

    controller = module.get<LlmController>(LlmController);
    service = module.get(LlmService) as jest.Mocked<LlmService>;
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('chat', () => {
    it('should return response from llm service', async () => {
      const chatDto = { message: 'Hello, how are you?' };
      const expectedResponse = 'I am doing well!';

      service.chatCompletion.mockResolvedValue(expectedResponse);

      const result = await controller.chat(chatDto);

      expect(service.chatCompletion).toHaveBeenCalledWith(chatDto.message);
      expect(result).toEqual({ response: expectedResponse });
    });

    it('should handle errors from llm service', async () => {
      const chatDto = { message: 'Hello' };
      const error = new Error('Service error');

      service.chatCompletion.mockRejectedValue(error);

      await expect(controller.chat(chatDto)).rejects.toThrow('Service error');
      expect(service.chatCompletion).toHaveBeenCalledWith(chatDto.message);
    });
  });
});