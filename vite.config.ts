import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react-swc';

export default defineConfig(({ mode }) => {
  // Load both VITE_* and non-prefixed env vars (e.g. AI_BASE_URL) at build/dev time.
  // NOTE: Defining non-VITE env vars here embeds them into the client bundle.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    define: {
      // Allow using AI_BASE_URL / AI_SERVER_API_KEY_AUTH without VITE_ prefix.
      'import.meta.env.AI_BASE_URL': JSON.stringify(env.AI_BASE_URL || ''),
      'import.meta.env.AI_SERVER_API_KEY_AUTH': JSON.stringify(
        env.AI_SERVER_API_KEY_AUTH || '',
      ),
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        // Proxy API calls to FastAPI backend on localhost:8000
        '/api': {
          target: 'http://localhost:8000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  };
});

