import { ChatCircleDots, User } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import type { AnalyzerAgentMessage } from "../../shared/contracts";

export function AnalyzerChat({
  messages,
  busy,
}: {
  messages: AnalyzerAgentMessage[];
  busy: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages, busy]);

  return (
    <div className="analyzer-chat" ref={scrollRef} aria-live="polite">
      <ChatMessage
        role="assistant"
        content="告诉我希望记录或提醒什么。直播间可以是任意类型，不需要描述字段、格式或提示词。"
        hint="例如：主播提到某个品牌的价格变化时提醒我，并记录品牌、原价、新价格和原话。"
      />
      {messages.map((message, index) => (
        <ChatMessage
          role={message.role}
          content={message.content}
          key={`${message.role}-${index}`}
        />
      ))}
      {busy && (
        <ChatMessage role="assistant" content="正在整理需求…" pending />
      )}
    </div>
  );
}

function ChatMessage({
  role,
  content,
  hint,
  pending = false,
}: {
  role: AnalyzerAgentMessage["role"];
  content: string;
  hint?: string;
  pending?: boolean;
}) {
  return (
    <div className={`analyzer-chat-message ${role}`}>
      <span className="analyzer-chat-avatar" aria-hidden="true">
        {role === "user" ? <User size={14} weight="bold" /> : <ChatCircleDots size={15} weight="fill" />}
      </span>
      <div className="analyzer-chat-content">
        <b>{role === "user" ? "你" : "创建助手"}</b>
        <p className={pending ? "pending" : undefined}>{content}</p>
        {hint && <small>{hint}</small>}
      </div>
    </div>
  );
}
