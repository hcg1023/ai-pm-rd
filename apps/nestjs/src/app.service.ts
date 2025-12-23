import { Injectable } from "@nestjs/common";

@Injectable()
export class AppService {
  getHello(): string {
    return "AI 对话助手后端服务正在运行！";
  }
}
