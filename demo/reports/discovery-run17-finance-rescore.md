# discovery-run17 财经候选补充识别

`demo/reports/discovery-run17-links.json` 的原始关键词规则漏掉了一个疑似财经候选，原因是标题使用了“利好 / 市场主线 / 大A”，不在旧关键词表中。

## 补充候选

- `https://live.douyin.com/16743488023` score=4 hits=利好,主线,市场主线,大A text=利好信号出现？市场主线看它！ @大A付老大-九点 1561

## 规则修正

`demo/scripts/discover_douyin_live_links.py` 已补充 `利好`、`主线`、`市场主线`、`大A`、`大a`。
