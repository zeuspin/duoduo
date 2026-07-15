# 滚动捕获片段有效性审计报告

输入 summary：`demo/reports/rolling-capture-logs/run25_C3_400595809668_20260709T0913_summary.jsonl`

## 总览

| 项目 | 值 |
| --- | ---: |
| 请求片段数 | 10 |
| 有效片段数 | 3 |
| 无效片段数 | 7 |
| 连续尾部无效片段数 | 6 |
| 疑似中途失流 | True |
| 是否全部有效 | False |
| 无效分类 | `{"valid": 3, "audio_file_too_small": 1, "mediarecorder_empty_blob": 3, "invalid_unknown": 3}` |

## 片段明细

| 段 | 原始 ok | actual_bytes | audio_probe_ok | valid_segment | 分类 | 文件 |
| ---: | --- | ---: | --- | --- | --- | --- |
| 1 | True | 967089 | True | True | valid | `demo/samples/audio/raw/run25_C3_400595809668_20260709T0913_seg01_60s_page_capture.webm` |
| 2 | True | 905834 | True | True | valid | `demo/samples/audio/raw/run25_C3_400595809668_20260709T0913_seg02_60s_page_capture.webm` |
| 3 | False | 429 | False | False | audio_file_too_small | `demo/samples/audio/raw/run25_C3_400595809668_20260709T0913_seg03_60s_page_capture.webm` |
| 4 | True | 10871 | True | True | valid | `demo/samples/audio/raw/run25_C3_400595809668_20260709T0913_seg04_60s_page_capture.webm` |
| 5 | False | 0 | False | False | mediarecorder_empty_blob | `demo/samples/audio/raw/run25_C3_400595809668_20260709T0913_seg05_60s_page_capture.webm` |
| 6 | False | 0 | False | False | mediarecorder_empty_blob | `demo/samples/audio/raw/run25_C3_400595809668_20260709T0913_seg06_60s_page_capture.webm` |
| 7 | False | 0 | False | False | mediarecorder_empty_blob | `demo/samples/audio/raw/run25_C3_400595809668_20260709T0913_seg07_60s_page_capture.webm` |
| 8 | False | 0 | False | False | invalid_unknown | `demo/samples/audio/raw/run25_C3_400595809668_20260709T0913_seg08_60s_page_capture.webm` |
| 9 | False | 0 | False | False | invalid_unknown | `demo/samples/audio/raw/run25_C3_400595809668_20260709T0913_seg09_60s_page_capture.webm` |
| 10 | False | 0 | False | False | invalid_unknown | `demo/samples/audio/raw/run25_C3_400595809668_20260709T0913_seg10_60s_page_capture.webm` |
