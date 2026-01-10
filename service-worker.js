// Configuration
const CACHE_NAME = 'mon-app-v1.0';
const OFFLINE_URL = '/offline.html';
const CLOUD_URL = 'https://ton-cloud-proton.com'; // Remplace par ton URL

// Fichiers à mettre en cache IMMÉDIATEMENT
const PRECACHE_FILES = [
  './',
  './style.css',
  './manifest.json',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/favicon.ico',
  './offline.html',
  './sync-manager.js'
];

// ==================== INSTALLATION ====================
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installation...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Mise en cache des fichiers essentiels');
        return cache.addAll(PRECACHE_FILES);
      })
      .then(() => {
        console.log('[Service Worker] Installation terminée');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[Service Worker] Erreur d\'installation:', error);
      })
  );
});

// ==================== ACTIVATION ====================
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activation...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Supprime les anciens caches
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Suppression ancien cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
    .then(() => {
      console.log('[Service Worker] Prêt pour le contrôle des clients');
      return self.clients.claim();
    })
  );
});

// ==================== STRATÉGIES DE CACHE ====================

// Stratégie: Cache d'abord (pour les assets statiques)
async function cacheFirstStrategy(request) {
  console.log('[Service Worker] Stratégie: Cache d\'abord pour:', request.url);
  
  try {
    // 1. Vérifie le cache
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      console.log('[Service Worker] Trouvé dans le cache:', request.url);
      return cachedResponse;
    }
    
    // 2. Si pas en cache, va sur le réseau
    console.log('[Service Worker] Non trouvé en cache, fetch réseau:', request.url);
    const networkResponse = await fetch(request);
    
    // 3. Mise en cache pour la prochaine fois
    if (networkResponse.ok && request.method === 'GET') {
      const cache = await caches.open(CACHE_NAME);
      console.log('[Service Worker] Mise en cache de:', request.url);
      await cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
    
  } catch (error) {
    console.error('[Service Worker] Erreur cacheFirst:', error);
    
    // Fallback pour les pages
    if (request.destination === 'document' || request.mode === 'navigate') {
      const fallback = await caches.match(OFFLINE_URL);
      if (fallback) return fallback;
    }
    
    return new Response('Service indisponible hors ligne', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

// Stratégie: Réseau d'abord (pour les données dynamiques)
async function networkFirstStrategy(request) {
  console.log('[Service Worker] Stratégie: Réseau d\'abord pour:', request.url);
  
  try {
    // 1. Essaie le réseau d'abord
    const networkResponse = await fetch(request);
    
    // 2. Mise en cache si succès
    if (networkResponse.ok) {
      const cache = await caches.open('dynamic-cache');
      await cache.put(request, networkResponse.clone());
      
      // Synchroniser avec le cloud si c'est une requête API
      if (request.url.includes('/api/')) {
        queueForCloudSync(request, await networkResponse.clone().json());
      }
    }
    
    return networkResponse;
    
  } catch (error) {
    console.log('[Service Worker] Hors ligne, vérifie le cache:', request.url);
    
    // 3. Fallback: vérifie le cache
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      console.log('[Service Worker] Fallback depuis cache:', request.url);
      return cachedResponse;
    }
    
    // 4. Aucun cache disponible
    console.log('[Service Worker] Aucun cache disponible pour:', request.url);
    
    // Pour les API, retourne une réponse offline
    if (request.url.includes('/api/')) {
      return new Response(JSON.stringify({
        status: 'offline',
        message: 'Mode hors ligne - Données locales',
        timestamp: new Date().toISOString(),
        data: null
      }), {
        status: 200,
        headers: { 
          'Content-Type': 'application/json',
          'X-Offline': 'true'
        }
      });
    }
    
    throw error;
  }
}

// ==================== GESTION DES REQUÊTES ====================
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Ignore les requêtes non-GET
  if (event.request.method !== 'GET') {
    // Pour POST/PUT/DELETE, stocke pour sync plus tard
    if (['POST', 'PUT', 'DELETE'].includes(event.request.method)) {
      event.respondWith(handleOfflineRequest(event));
    }
    return;
  }
  
  // Pour les assets statiques (CSS, images, etc.)
  if (url.pathname.match(/\.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$/)) {
    event.respondWith(cacheFirstStrategy(event.request));
    return;
  }
  
  // Pour les API/Données dynamiques
  if (url.pathname.startsWith('/api/') || url.hostname.includes('cloud')) {
    event.respondWith(networkFirstStrategy(event.request));
    return;
  }
  
  // Pour les pages HTML
  if (event.request.mode === 'navigate') {
    event.respondWith(cacheFirstStrategy(event.request));
    return;
  }
  
  // Par défaut: cache d'abord
  event.respondWith(cacheFirstStrategy(event.request));
});

// ==================== FONCTIONS DE SYNC ====================

// File d'attente pour la sync cloud
const SYNC_QUEUE = 'sync-queue';

async function handleOfflineRequest(event) {
  const request = event.request;
  
  try {
    // Essaie d'abord en ligne
    if (navigator.onLine) {
      const response = await fetch(request);
      return response;
    }
    
    // Hors ligne: stocke pour plus tard
    const requestData = {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      timestamp: Date.now(),
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 9)
    };
    
    // Pour les requêtes avec body
    if (request.method === 'POST' || request.method === 'PUT') {
      const body = await request.clone().text();
      requestData.body = body;
    }
    
    // Stocke dans IndexedDB via postMessage
    const client = await self.clients.get(event.clientId);
    if (client) {
      client.postMessage({
        type: 'QUEUE_SYNC_REQUEST',
        data: requestData
      });
    }
    
    // Réponse immédiate
    return new Response(JSON.stringify({
      status: 'queued',
      message: 'Requête mise en file d\'attente pour synchronisation',
      queueId: requestData.id,
      timestamp: new Date().toISOString()
    }), {
      status: 202, // Accepted
      headers: { 
        'Content-Type': 'application/json',
        'X-Offline-Queue': 'true'
      }
    });
    
  } catch (error) {
    console.error('[Service Worker] Erreur handleOfflineRequest:', error);
    
    return new Response(JSON.stringify({
      status: 'error',
      message: 'Erreur de traitement hors ligne',
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Queue pour sync cloud
async function queueForCloudSync(request, data) {
  try {
    const syncData = {
      url: request.url,
      method: request.method,
      data: data,
      timestamp: Date.now(),
      attempts: 0,
      maxAttempts: 3
    };
    
    // Stocke dans IndexedDB
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'STORE_SYNC_DATA',
        data: syncData
      });
    });
    
  } catch (error) {
    console.error('[Service Worker] Erreur queueForCloudSync:', error);
  }
}

// ==================== SYNC EN ARRIÈRE-PLAN ====================
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-cloud') {
    console.log('[Service Worker] Sync en arrière-plan déclenchée');
    event.waitUntil(syncWithCloud());
  }
});

async function syncWithCloud() {
  try {
    const cache = await caches.open('sync-cache');
    const keys = await cache.keys();
    
    for (const request of keys) {
      if (request.url.includes('/api/')) {
        try {
          const response = await fetch(request);
          if (response.ok) {
            await cache.delete(request);
          }
        } catch (error) {
          console.log('[Service Worker] Sync échouée, réessaiera plus tard:', request.url);
        }
      }
    }
  } catch (error) {
    console.error('[Service Worker] Erreur syncWithCloud:', error);
  }
}

// ==================== PUSH NOTIFICATIONS ====================
self.addEventListener('push', (event) => {
  if (!event.data) return;
  
  const data = event.data.json();
  const options = {
    body: data.body || 'Nouvelle mise à jour disponible',
    icon: './assets/icon-192.png',
    badge: './assets/badge.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || './',
      timestamp: Date.now()
    },
    actions: [
      {
        action: 'open',
        title: 'Ouvrir'
      },
      {
        action: 'close',
        title: 'Fermer'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title || 'Mon App', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'open') {
    event.waitUntil(
      clients.openWindow(event.notification.data.url || './')
    );
  }
});

// ==================== MESSAGES ====================
self.addEventListener('message', (event) => {
  const { type, data } = event.data;
  
  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
      
    case 'CLEAR_CACHE':
      caches.delete(CACHE_NAME);
      break;
      
    case 'GET_CACHE_INFO':
      event.ports[0].postMessage({
        cacheName: CACHE_NAME,
        timestamp: Date.now()
      });
      break;
  }
});

console.log('[Service Worker] Chargé et prêt!');
