import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/api/uspto': {
        target: 'https://api.uspto.gov/api',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/uspto/, ''),
      },
    },
  },
});
