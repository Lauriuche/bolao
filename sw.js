// --- CONFIGURAÇÃO DE VERSÃO ---
// TODA VEZ que atualizar o site, mude esse nome (ex: v1 -> v2 -> v3)
const CACHE_NAME = 'bolao-camino-v7'; 

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.png',
  './1001855377.png'
];

// Instalação: Cacheia os arquivos e força a substituição imediata
self.addEventListener('install', (event) => {
  self.skipWaiting(); // Força o novo SW a entrar em ação imediatamente
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// Ativação: Limpa os caches antigos para liberar espaço e garantir atualização
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('Limpando cache antigo:', cache);
            return caches.delete(cache);
          }
        })
      );
    })
  );
  return self.clients.claim(); // Assume o controle da página imediatamente
});

// Interceptação: Serve o cache, mas se falhar, tenta a rede
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
