# 滚动捕获片段有效性审计报告

输入 summary：`demo/reports/rolling-capture-logs/run24_C3_812755146455_20260709T0901_summary.jsonl`

## 总览

| 项目 | 值 |
| --- | ---: |
| 请求片段数 | 10 |
| 有效片段数 | 3 |
| 无效片段数 | 7 |
| 连续尾部无效片段数 | 7 |
| 疑似中途失流 | True |
| 是否全部有效 | False |
| 无效分类 | `{"valid": 3, "mediarecorder_empty_blob": 7}` |

## 片段明细

| 段 | 原始 ok | actual_bytes | audio_probe_ok | valid_segment | 分类 | 文件 |
| ---: | --- | ---: | --- | --- | --- | --- |
| 1 | True | 967089 | True | True | valid | `demo/samples/audio/raw/run24_C3_812755146455_20260709T0901_seg01_60s_page_capture.webm` |
| 2 | True | 967089 | True | True | valid | `demo/samples/audio/raw/run24_C3_812755146455_20260709T0901_seg02_60s_page_capture.webm` |
| 3 | True | 181945 | True | True | valid | `demo/samples/audio/raw/run24_C3_812755146455_20260709T0901_seg03_60s_page_capture.webm` |
| 4 | False | 0 | False | False | mediarecorder_empty_blob | `demo/samples/audio/raw/run24_C3_812755146455_20260709T0901_seg04_60s_page_capture.webm` |
| 5 | False | 0 | False | False | mediarecorder_empty_blob | `demo/samples/audio/raw/run24_C3_812755146455_20260709T0901_seg05_60s_page_capture.webm` |
| 6 | False | 0 | False | False | mediarecorder_empty_blob | `demo/samples/audio/raw/run24_C3_812755146455_20260709T0901_seg06_60s_page_capture.webm` |
| 7 | False | 0 | False | False | mediarecorder_empty_blob | `demo/samples/audio/raw/run24_C3_812755146455_20260709T0901_seg07_60s_page_capture.webm` |
| 8 | False | 0 | False | False | mediarecorder_empty_blob | `demo/samples/audio/raw/run24_C3_812755146455_20260709T0901_seg08_60s_page_capture.webm` |
| 9 | False | 0 | False | False | mediarecorder_empty_blob | `demo/samples/audio/raw/run24_C3_812755146455_20260709T0901_seg09_60s_page_capture.webm` |
| 10 | False | 0 | False | False | mediarecorder_empty_blob | `demo/samples/audio/raw/run24_C3_812755146455_20260709T0901_seg10_60s_page_capture.webm` |
