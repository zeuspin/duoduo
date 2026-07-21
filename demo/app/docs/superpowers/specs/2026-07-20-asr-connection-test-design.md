# ASR 连接测试设计

## 问题

百炼 ASR 的连接测试在收到 `task-started` 后立即调用正常会话的 `close()`。正常关闭会发送 `finish-task`，但测试期间没有发送音频，因此百炼返回 `NO_VALID_AUDIO_ERROR`，使有效 Key 被误报为连接失败。

## 设计

- 连接测试只验证鉴权、WebSocket 连接和 ASR 任务能否启动。
- 收到 `task-started` 即视为连接成功，并直接中止测试会话，不发送 `finish-task`。
- 正常识别会话的 `close()` 行为保持不变，继续等待 `task-finished`。
- 为测试会话增加明确的 `abort()` 能力，仅负责关闭 socket 和清理监听器，不记录正常识别成功或失败用量。

## 验收

- `testConnection()` 收到 `task-started` 后返回成功。
- 测试期间只发送 `run-task`，不发送 PCM 或 `finish-task`。
- socket 被关闭。
- 正常 ASR 会话的发送、完成和计量行为不变。

