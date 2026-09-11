import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * In sviluppo, `/member-portal` deve aprire il guscio del portale.
 *
 * Con due punti d'ingresso Vite serve `member.html` a chi chiede `/member.html`, e basta:
 * non sa che quel guscio governa anche `/member-portal/qr`. In produzione ci pensa Fastify
 * (`server/src/app.js`), ma in sviluppo Fastify non c'è — e senza questo, ricaricare una
 * pagina del portale darebbe 404 mentre in produzione funziona. È il modo peggiore di
 * scoprire un guasto: quello in cui l'ambiente di sviluppo mente.
 */
function gusciInSviluppo() {
  return {
    name: 'grip-gusci-in-sviluppo',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const percorso = (req.url ?? '').split('?')[0];
        if (percorso.toLowerCase().startsWith('/member-portal')) req.url = '/member.html';
        next();
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), gusciInSviluppo()],
  resolve: {
    // L'alias "@" era fornito dal plugin del vecchio backend; ora è dichiarato qui.
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      // Due applicazioni, due pacchetti. Il portale soci non è più una sezione del
      // gestionale: ha un ingresso suo, e quello che non entra da lì non lo scarica.
      input: {
        staff: path.resolve(import.meta.dirname, 'index.html'),
        member: path.resolve(import.meta.dirname, 'member.html'),
      },
    },
  },
});
