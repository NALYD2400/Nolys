import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Interface des deux fenêtres Tauri : l'Island (JS natif) et les réglages (React + Liquid Glass).
export default defineConfig({
    root: 'src',
    publicDir: 'public',
    plugins: [react()],
    clearScreen: false,
    server: { port: 1420, strictPort: true },
    build: {
        outDir: '../dist',
        emptyOutDir: true,
        assetsDir: '_app',
        target: 'chrome120',
        // React + Liquid Glass forment un seul paquet local (~230 Ko gzip), chargé seulement à l'ouverture des réglages.
        chunkSizeWarningLimit: 900,
        rollupOptions: {
            input: {
                island: resolve(import.meta.dirname, 'src/island/index.html'),
                settings: resolve(import.meta.dirname, 'src/settings/index.html'),
            },
        },
    },
});
