import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

//two ES modules with their dependencies inside, so a site needs nothing else
export default defineConfig({
  build: {
    outDir: here('./dist'),
    emptyOutDir: true,
    target: 'es2022',
    minify: false,
    lib: { entry: { index: here('./src/index.ts'), server: here('./src/server.ts') }, formats: ['es'] },
  },
});
