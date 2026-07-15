# Windows x64 构建与验收

## 推荐方式

将 `demo/app` 作为 GitHub 仓库根目录，或把 `.github/workflows/build.yml` 移到实际仓库根目录后执行 `desktop-build` 工作流。

Windows runner 将执行：

```powershell
npm ci
npm run typecheck
npm test
npm run scan:secrets
npm run make -- --platform=win32 --arch=x64
```

预期产物位于：

```text
out/make/squirrel.windows/x64/*Setup.exe
out/make/squirrel.windows/x64/*.nupkg
out/make/squirrel.windows/x64/RELEASES
```

## 实机验收

1. 在 Windows x64 新机器安装 `Setup.exe`，机器无需 Node.js 或 Python。
2. 配置百炼 API Key并执行连接测试。
3. 添加三个当前正在讲话的公开直播间。
4. 同时静默监看至少 10 分钟，每张卡片必须出现自己的实时 ASR。
5. 停止其中一路，确认其他两路继续转写。
6. 退出应用，任务管理器中不得残留多多直播、WebContents 或 ASR 进程。
7. 保存产品截图、测试输出和安装包 SHA-256。

## 当前 Mac 交叉构建结果

- Windows x64 解包应用构建成功。
- portable ZIP 构建成功。
- Squirrel `.nupkg` 构建成功。
- `Setup.exe` 在 macOS Wine 的 `Squirrel.Utility.CreateZipFromDirectory` 阶段失败；Forge 维护者建议改在 Windows 或 Windows CI 构建，不采用可能生成无效安装包的 7zip 代理绕过方案。
