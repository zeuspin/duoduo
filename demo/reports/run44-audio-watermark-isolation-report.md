# 页面级音频捕获水印隔离测试

## 结论

- 页面音频水印：440 Hz
- 系统声音水印：1234 Hz
- 页面频率能量：55559756.280497
- 系统频率能量：0.178921
- 能量比 page/system：310526860.20
- 是否通过：True

## 判定

捕获音频中页面水印能量显著高于系统声音水印，说明页面级 captureStream 录到的是页面媒体流，系统 afplay 声音没有以可检测水印进入正式捕获文件。

## 文件

- 捕获音频：`demo/samples/audio/raw/run44_page_capture_with_system_1234hz.webm`
- 分析 WAV：`demo/samples/audio/raw/run44_page_capture_with_system_1234hz_16k.wav`
- 页面媒体：`demo/runtime/audio-isolation/run44-page-440hz.webm`
- 系统水印：`demo/runtime/audio-isolation/run44-system-1234hz.wav`
