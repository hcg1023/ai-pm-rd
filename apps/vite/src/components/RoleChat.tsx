import React, { useState, useRef, useCallback, useContext, createContext, memo, useEffect } from "react";
import { Card, Select, Space, message } from "antd";
import { Bubble, Sender, Think, Actions, ThoughtChain } from "@ant-design/x";
import { SyncOutlined } from "@ant-design/icons";
import XMarkdown, { type ComponentProps } from "@ant-design/x-markdown";

const { Option } = Select;

// ==================== Deep Thinking Component ====================
const ThinkComponent = memo<ComponentProps>((props) => {
  const [title, setTitle] = useState("深度思考中...");
  const [loading, setLoading] = useState(true);
  const [expand, setExpand] = useState(true);

  useEffect(() => {
    if (props.streamStatus === 'done') {
      setTitle('深度思考完成');
      setLoading(false);
      setExpand(false);
    }
  }, [props.streamStatus]);

  return (
    <Think title={title} loading={loading} expanded={expand} onClick={() => setExpand(!expand)}>
      {props.children}
    </Think>
  );
});

// ==================== Context ====================
interface MessageContextType {
  onReload?: (id: string, options?: any) => void;
}

const MessageContext = createContext<MessageContextType>({});

// ==================== Interfaces ====================
interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoningContent?: string;
  reasoningDuration?: number;
  timestamp: Date;
  status?: "loading" | "updating" | "success" | "error" | "abort";
}

// ==================== Footer Component ====================
const MessageFooter: React.FC<{
  id?: string;
  content: string;
  status?: Message["status"];
  onReload?: (id: string, options?: any) => void;
}> = ({ id, content, status, onReload }) => {
  const [mockFeedback, setMockFeedback] = useState<'default' | 'liked' | 'disliked'>('default');

  const items = [
    {
      key: 'retry',
      label: '重新生成',
      icon: <SyncOutlined />,
      onItemClick: () => {
        if (id && onReload) {
          onReload(id, { userAction: 'retry' });
        }
      },
    },
    {
      key: 'copy',
      actionRender: <Actions.Copy text={content} />,
    },
    {
      key: 'feedback',
      actionRender: (
        <Actions.Feedback
          value={mockFeedback}
          onChange={(val) => {
            setMockFeedback(val as any);
            message.success(`反馈: ${val}`);
          }}
        />
      ),
    },
  ];

  return status !== 'updating' && status !== 'loading' ? (
    <div style={{ display: "flex" }}>
      {id && <Actions items={items} />}
    </div>
  ) : null;
};

// ==================== Main Component ====================
const RoleChat: React.FC = () => {
  const [sourceRole, setSourceRole] = useState<string>("product-manager");
  const [targetRole, setTargetRole] = useState<string>("developer");
  const [inputValue, setInputValue] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const roles = [
    { value: "product-manager", label: "产品经理" },
    { value: "developer", label: "研发" },
    { value: "operations", label: "运营" },
    { value: "manager", label: "管理者" },
  ];

  // 思考链状态配置
  const thoughtChainConfig = {
    loading: {
      title: '正在调用模型',
      status: 'loading' as const,
    },
    updating: {
      title: '深度思考中',
      status: 'loading' as const,
    },
    success: {
      title: '思考完成',
      status: 'success' as const,
    },
    error: {
      title: '思考出错',
      status: 'error' as const,
    },
    abort: {
      title: '已中止',
      status: 'abort' as const,
    },
  };

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // 重新生成消息
  const handleReload = useCallback((msgId: string, options?: any) => {
    const msgIndex = messages.findIndex((m) => m.id === msgId);
    if (msgIndex === -1) return;

    const userMsg = messages[msgIndex - 1];
    if (!userMsg || userMsg.role !== "user") {
      message.warning("无法找到原始消息");
      return;
    }

    const newMessages = messages.slice(0, msgIndex);
    setMessages(newMessages);

    const content = userMsg.content.replace(/^\[[^\]]+\]\s*/, "");
    setInputValue(content);
    setTimeout(() => {
      handleSend();
    }, 100);
  }, [messages]);

  const handleSend = useCallback(async () => {
    if (!inputValue.trim()) {
      message.warning("请输入要转换的内容");
      return;
    }

    if (sourceRole === targetRole) {
      message.warning("源角色和目标角色不能相同");
      return;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: `[${roles.find((r) => r.value === sourceRole)?.label} → ${roles.find((r) => r.value === targetRole)?.label}] ${inputValue}`,
      timestamp: new Date(),
      status: "success",
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");

    const assistantMessageId = (Date.now() + 1).toString();
    setMessages((prev) => [
      ...prev,
      {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        reasoningContent: "",
        timestamp: new Date(),
        status: "loading",
      },
    ]);
    setLoading(true);

    const controller = new AbortController();
    setAbortController(controller);

    try {
      const response = await fetch("/api/llm/perspective-convert", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sourceRole,
          targetRole,
          content: inputValue,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error("请求失败");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";
      let fullReasoningContent = "";

      if (reader) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? { ...msg, status: "updating" as const }
              : msg,
          ),
        );

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") {
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessageId
                      ? { ...msg, status: "success" as const }
                      : msg,
                  ),
                );
                setLoading(false);
                setAbortController(null);
                break;
              }

              try {
                const parsed = JSON.parse(data);
                if (parsed.reasoning_content) {
                  fullReasoningContent += parsed.reasoning_content;
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMessageId
                        ? {
                            ...msg,
                            reasoningContent: fullReasoningContent,
                            status: "updating" as const,
                          }
                        : msg,
                    ),
                  );
                  scrollToBottom();
                }
                if (parsed.content) {
                  fullContent += parsed.content;
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMessageId
                        ? {
                            ...msg,
                            content: fullContent,
                            status: "updating" as const,
                          }
                        : msg,
                    ),
                  );
                  scrollToBottom();
                }
              } catch (e) {
                console.error("解析数据失败:", e);
              }
            }
          }
        }
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        message.info("已取消");
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? { ...msg, status: "abort" as const }
              : msg,
          ),
        );
      } else {
        message.error("转换失败: " + error.message);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? { ...msg, content: "转换失败，请重试", status: "error" as const }
              : msg,
          ),
        );
      }
      setLoading(false);
      setAbortController(null);
    }
  }, [inputValue, sourceRole, targetRole, roles, scrollToBottom, messages]);

  const handleCancel = useCallback(() => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
      setLoading(false);
    }
  }, [abortController]);

  const handleInputChange = useCallback((value: string) => {
    setInputValue(value);
  }, []);

  return (
    <MessageContext.Provider value={{ onReload: handleReload }}>
      <div
        style={{
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          background: "#f0f2f5",
          padding: "24px",
        }}
      >
        <Card style={{ marginBottom: 16 }}>
          <Space size="large" style={{ width: "100%", justifyContent: "center" }}>
            <div style={{ fontSize: 20, fontWeight: "bold", marginRight: 24 }}>
              AI 角色转换对话
            </div>
            <Space>
              <span>从</span>
              <Select
                value={sourceRole}
                onChange={setSourceRole}
                style={{ width: 120 }}
                disabled={loading}
              >
                {roles.map((role) => (
                  <Option key={role.value} value={role.value}>
                    {role.label}
                  </Option>
                ))}
              </Select>
              <span>到</span>
              <Select
                value={targetRole}
                onChange={setTargetRole}
                style={{ width: 120 }}
                disabled={loading}
              >
                {roles.map((role) => (
                  <Option key={role.value} value={role.value}>
                    {role.label}
                  </Option>
                ))}
              </Select>
              <span>的视角</span>
            </Space>
          </Space>
        </Card>

        <Card
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "auto",
          }}
          bodyStyle={{
            padding: 0,
            display: "flex",
            flexDirection: "column",
            flex: 1,
          }}
        >
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            {messages.length === 0 && (
              <div
                style={{ textAlign: "center", color: "#999", marginTop: "20%" }}
              >
                <p>选择角色并输入内容，开始AI角色转换对话</p>
              </div>
            )}

            {messages.map((msg) => {
              const isAssistant = msg.role === "assistant";
              const hasReasoning = isAssistant && msg.reasoningContent;
              const config = thoughtChainConfig[msg.status || 'success' as keyof typeof thoughtChainConfig];

              return (
                <div key={msg.id} style={{ width: "100%" }}>
                  {isAssistant && config && (
                    <div style={{ marginBottom: 8, marginLeft: 0 }}>
                      <ThoughtChain.Item
                        status={config.status}
                        variant="solid"
                        icon={<span>💭</span>}
                        title={config.title}
                      />
                    </div>
                  )}

                  <Bubble
                    key={msg.id}
                    placement={msg.role === "user" ? "end" : "start"}
                    typing={msg.status === "updating" ? { step: 5, interval: 20 } : false}
                    content={msg.status === "error" ? "转换失败，请重试" : msg.content}
                    contentRender={(content) => (
                      msg.status === "error" ? (
                        <div style={{ color: "#ff4d4f" }}>{content}</div>
                      ) : (
                        <>
                          {/* 深度思考内容 */}
                          {hasReasoning && msg.reasoningContent && (
                            <Think
                              title="深度思考中..."
                              loading={msg.status === "updating"}
                              expanded={true}
                            >
                              <XMarkdown
                                streaming={{
                                  hasNextChunk: msg.status === "updating",
                                  enableAnimation: true,
                                }}
                              >
                                {msg.reasoningContent}
                              </XMarkdown>
                            </Think>
                          )}
                          {/* 最终内容 */}
                          <XMarkdown
                            streaming={{
                              hasNextChunk: msg.status === "updating",
                              enableAnimation: true,
                            }}
                          >
                            {content}
                          </XMarkdown>
                        </>
                      )
                    )}
                    footer={
                      isAssistant && msg.status === "success" && msg.content ? (
                        <MessageFooter
                          id={msg.id}
                          content={msg.content}
                          status={msg.status}
                          onReload={handleReload}
                        />
                      ) : undefined
                    }
                    styles={{
                      content: {
                        maxWidth: "70%",
                      },
                    }}
                  />
                </div>
              );
            })}

            <div ref={messagesEndRef} />
          </div>

          <div style={{ padding: "16px", borderTop: "1px solid #f0f0f0" }}>
            <Sender
              value={inputValue}
              onChange={handleInputChange}
              onSubmit={handleSend}
              onCancel={handleCancel}
              loading={loading}
              placeholder="输入要转换的内容..."
              autoSize={{ minRows: 3, maxRows: 8 }}
              style={{
                borderRadius: 8,
              }}
            />
          </div>
        </Card>
      </div>
    </MessageContext.Provider>
  );
};

export default RoleChat;
