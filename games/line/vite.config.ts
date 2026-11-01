import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  const isWx = mode === 'wx';
  return {
    server: { port: 5173, host: '0.0.0.0' },
    define: {
      __TARGET__: JSON.stringify(isWx ? 'wechat' : 'web'),
      __API_BASE__: JSON.stringify(process.env.API_BASE ?? 'http://127.0.0.1:8080'),
    },
    build: {
      target: 'es2017',
      outDir: isWx ? '../line-wx/dist' : 'dist',
      assetsInlineLimit: 0,
      rollupOptions: isWx
        ? {
            output: {
              // 微信小游戏不支持 ESM，打包成 CommonJS 单文件，由 game.js require
              format: 'cjs',
              entryFileNames: 'game.js',
              inlineDynamicImports: true,
            },
          }
        : {},
    },
  };
});
