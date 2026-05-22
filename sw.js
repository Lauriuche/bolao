// --- CONTROLE DE VERSÕES DO SEU BOLÃO ---
// Atualizado para v1.0.1 para forçar a atualização imediata do novo endpoint da InfinitePay nos telemóveis.
const CACHE_VERSION = 'v1.0.1';
const CACHE_NAME = `bolao-master-cache-${CACHE_VERSION}`;

// Lista de arquivos estáticos para salvar em cache local (modo offline)
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap',
  'https://unpkg.com/lucide@latest'
];

// Instalação do Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log(`[Service Worker] Criando cache de versão: ${CACHE_VERSION}`);
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Ativação e limpeza automática de versões antigas de cache
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName.startsWith('bolao-master-cache-') && cacheName !== CACHE_NAME) {
            console.log(`[Service Worker] Removendo cache desatualizado: ${cacheName}`);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Intercetação de requisições de rede com estratégia Network-First
self.addEventListener('fetch', (event) => {
  // Ignora requisições de bancos de dados Firebase e integrações externas dinâmicas
  if (
    event.request.url.includes('firebaseio.com') ||
    event.request.url.includes('googleapis.com') ||
    event.request.url.includes('infinitepay.io') ||
    event.request.url.includes('corsproxy.io')
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});