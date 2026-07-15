import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function localElectronZipDirectory(): string | undefined {
  if (process.env.ELECTRON_ZIP_DIR) return process.env.ELECTRON_ZIP_DIR;
  if (process.platform !== "darwin") return undefined;
  const root = join(homedir(), "Library", "Caches", "electron");
  if (!existsSync(root)) return undefined;
  const electronVersion = JSON.parse(readFileSync(join(process.cwd(), "node_modules", "electron", "package.json"), "utf8")).version as string;
  const archiveName = `electron-v${electronVersion}-darwin-arm64.zip`;
  for (const directory of readdirSync(root)) {
    const candidate = join(root, directory);
    if (existsSync(join(candidate, archiveName))) return candidate;
  }
  return undefined;
}

const config: ForgeConfig = {
  packagerConfig: { asar: true, name: "Duoduo Live", electronZipDir: localElectronZipDirectory() },
  makers: [
    new MakerSquirrel({ name: "duoduo_live" }),
    new MakerZIP({}, ["darwin"]),
    new MakerDMG({ format: "ULFO" }),
  ],
  plugins: [new VitePlugin({
    build: [
      { entry: "src/main/main.ts", config: "vite.main.config.ts", target: "main" },
      { entry: "src/preload/preload.ts", config: "vite.preload.config.ts", target: "preload" },
      { entry: "src/preload/room-capture.ts", config: "vite.preload.config.ts", target: "preload" },
    ],
    renderer: [{ name: "main_window", config: "vite.renderer.config.ts" }],
  })],
};

export default config;
