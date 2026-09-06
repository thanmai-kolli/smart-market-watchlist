import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Fail loudly instead of drifting to 5174: the API allows exactly one origin,
    // so a silent port change would break requests in a confusing way.
    strictPort: true,
  },
});
