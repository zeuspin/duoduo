import { defineConfig } from "vite";
export default defineConfig({
  define: {
    "process.env.WS_NO_BUFFER_UTIL": JSON.stringify("1"),
    "process.env.WS_NO_UTF_8_VALIDATE": JSON.stringify("1"),
  },
  build: { sourcemap: true },
});
