# 抖音直播链接规范化约定

## 目的

Safari 可用于登录状态下查找博主和直播间，但验收、播放、采样和 ASR 测试必须使用无登录状态的独立 Chrome profile。为避免把登录来源、分享来源或其他追踪参数写入样本清单，所有直播链接进入 `demo/` 文档前需要规范化。

## 规范格式

```text
https://live.douyin.com/{room_id}
```

示例：

```text
https://live.douyin.com/727845008784
```

## 处理规则

- 只保留域名 `live.douyin.com` 和直播间路径中的数字 ID。
- 删除 `?` 后的所有查询参数。
- 删除 `#` 后的所有片段参数。
- 不保存 Cookie、登录态、分享来源、进入来源、推荐来源。
- 规范化后的链接必须再用无登录状态的独立 Chrome profile / user-data-dir 验证匿名可打开。

## 命令示例

```bash
python3 - <<'PY'
from urllib.parse import urlparse

raw = "https://live.douyin.com/727845008784?from=share&foo=bar"
parsed = urlparse(raw)
room_id = parsed.path.strip("/").split("/")[0]
print(f"https://live.douyin.com/{room_id}")
PY
```

## 使用边界

- Safari：只用于搜索和获取候选链接。
- 独立 Chrome profile：用于匿名播放验证、音频捕获和 ASR 测试。
- 若 Safari 中打开了直播页面，只作为人工确认候选内容类型；不要在 Safari 中多开直播或录制。
