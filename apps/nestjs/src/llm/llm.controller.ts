import { Controller, Post, Body, Res } from "@nestjs/common";
import { Response } from "express";
import { LlmService } from "./llm.service";
import { IsNotEmpty, IsString, IsIn } from "class-validator";

export class ChatDto {
  message!: string;
}

export class PerspectiveConvertDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(["product-manager", "developer", "operations", "manager"], {
    message:
      "源角色必须是：product-manager, developer, operations, manager 之一",
  })
  sourceRole!: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(["product-manager", "developer", "operations", "manager"], {
    message:
      "目标角色必须是：product-manager, developer, operations, manager 之一",
  })
  targetRole!: string;

  @IsString()
  @IsNotEmpty()
  content!: string;
}

@Controller("llm")
export class LlmController {
  constructor(private readonly llmService: LlmService) {}

  @Post("perspective-convert")
  async perspectiveConvert(
    @Body() dto: PerspectiveConvertDto,
    @Res() res: Response,
  ) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    try {
      const [stream$, abortController] =
        await this.llmService.perspectiveConvertStream(
          dto.sourceRole,
          dto.targetRole,
          dto.content,
        );

      const subscription = stream$.subscribe({
        next: (data) => {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        },
        complete: () => {
          res.off("close", handleClose);
          res.write("data: [DONE]\n\n");
          res.end();
        },
        error: (err) => {
          const errorMessage = err instanceof Error ? err.message : "未知错误";
          res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
          res.end();
        },
      });

      const handleClose = () => {
        subscription.unsubscribe();
        abortController.abort();
      };

      res.on("close", handleClose);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "未知错误";
      res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
      res.end();
    }
  }
}
