import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Interface de la fenêtre Tauri de l'Island (JS natif). Les Réglages (React et styles locaux) y
// sont un mode de la capsule, chargé à la demande (src/settings/mount.jsx).
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
        // Le paquet React des Réglages est chargé au repos après le lancement
        // ou à leur première ouverture.
        chunkSizeWarningLimit: 900,
        rollupOptions: {
            input: {
                island: resolve(import.meta.dirname, 'src/island/index.html'),
            },
        },
    },
});
