import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" so the build works on GitHub Pages project sites (repo subpath)
export default defineConfig({
  base: "./",
  plugins: [react()],
});
