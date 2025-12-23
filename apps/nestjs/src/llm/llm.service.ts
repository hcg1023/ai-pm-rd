import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI, { ClientOptions } from "openai";
import { Observable, ReplaySubject, from } from "rxjs";
import { ChatCompletionChunk } from "openai/resources/chat/completions";
import { RoleConfig } from "../config/roles.config";

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly openai: OpenAI;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>("openai.apiKey");
    const baseURL = this.configService.get<string>("openai.baseURL");

    const openaiConfig: ClientOptions = {
      apiKey,
    };

    // 只有当baseURL存在时才添加到配置中
    if (baseURL) {
      openaiConfig.baseURL = baseURL;
    }

    this.openai = new OpenAI(openaiConfig);

    this.logger.log(
      `OpenAI client initialized with baseURL: ${baseURL || "default"}`,
    );
  }

  async perspectiveConvertStream(
    sourceRole: string,
    targetRole: string,
    content: string,
  ): Promise<
    [ReplaySubject<ChatCompletionChunk.Choice.Delta>, AbortController]
  > {
    try {
      const roles =
        this.configService.get<Record<string, RoleConfig>>("roles.roles");

      if (!roles) {
        throw new Error("角色配置未找到");
      }

      const sourceRoleConfig = roles[sourceRole];
      const targetRoleConfig = roles[targetRole];

      if (!sourceRoleConfig) {
        throw new Error(`源角色 "${sourceRole}" 不存在`);
      }

      if (!targetRoleConfig) {
        throw new Error(`目标角色 "${targetRole}" 不存在`);
      }

      this.logger.log(
        `Converting perspective from ${sourceRoleConfig.name} to ${targetRoleConfig.name}`,
      );

      // 构建系统提示词
      const systemPrompt = `你是一个专业的沟通翻译助手。现在有一段从【${sourceRoleConfig.name}】视角描述的内容，请你将其转换为【${targetRoleConfig.name}】关注的视角来重新表述。

## 原角色视角：${sourceRoleConfig.name}

${sourceRoleConfig.prompt}

## 目标角色视角：${targetRoleConfig.name}

${targetRoleConfig.prompt}

## 转换要求

**重要约束**：
- 只做视角转换和翻译，**允许基于视角添加适当的建议、想法或扩展内容，但不能过多**
- 要结合实际的业务场景进行转换，不能仅仅是字面意思的转换

请根据以上两个角色的关注点，将以下内容从【${targetRoleConfig.name}】的视角重新表述：
- 深入理解原文内容的核心要点
- 从目标角色的关注角度重新组织和表述
- 保持信息的准确性和完整性
- 使用符合目标角色习惯的表达方式
- 以 markdown 格式输出

## 示例

**示例 1：从产品经理视角翻译到研发视角**

**输入（产品经理视角）**：
我们需要一个智能推荐功能，提升用户停留时长

**输出（研发视角应包含）**：
- 推荐算法类型建议（协同过滤/内容推荐等）
- 数据来源和处理方式
- 性能和实时性要求
- 预估开发工作量

**示例 2：从研发视角翻译到产品经理视角**

**输入（研发视角）**：
我们优化了数据库查询，QPS提升了30%

**输出（产品经理视角应包含）**：
- 对用户体验的实际影响
- 支持的业务增长空间
- 成本降低的商业价值`;

      const userMessage = `## 原始内容

${content}

## 转换后的内容

请从【${targetRoleConfig.name}】的视角重新表述上述内容：`;

      const model = this.configService.get<string>("openai.model");

      const stream = await this.openai.chat.completions.create({
        model: model!,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userMessage,
          },
        ],
        stream: true,
      });

      // 创建一个 ReplaySubject 并指定缓存数量，这里设置为 -1 表示缓存所有数据
      const replaySubject = new ReplaySubject<ChatCompletionChunk.Choice.Delta>(
        -1,
      );

      // 使用 RxJS Observable 包装流式响应
      const observable = from(
        (async function* () {
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta;
            if (delta) {
              yield delta;
            }
          }
        })(),
      );

      // 订阅 observable 并将数据转发到 replaySubject
      const subscription = observable.subscribe({
        next: (data) => {
          this.logger.log(`Received delta: ${JSON.stringify(data)}`);
          replaySubject.next(data);
        },
        complete: () => {
          replaySubject.complete();
        },
        error: (err) => {
          replaySubject.error(err);
        },
      });

      // 当 abort 时取消订阅
      stream.controller.signal.addEventListener("abort", () => {
        subscription.unsubscribe();
        replaySubject.complete();
      });

      this.logger.log("Perspective conversion stream started");
      return [replaySubject, stream.controller];
    } catch (error) {
      this.logger.error("Error in perspective conversion:", error);
      throw error;
    }
  }
}
