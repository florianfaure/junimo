import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { astryxStylex } from "@astryxdesign/build/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  // Astryx StyleX pipeline (compile @astryxdesign/* atomic styles) + React.
  // Order matters: astryxStylex() must run before react() (cf. facebook/astryx
  // apps/example-vite). astryxStylex() returns an array of plugins.
  plugins: [...astryxStylex(), react()],
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
