// 楽天ウォレット Pro - Service Worker (GitHub Pages対応版)
// オフライン対応、キャッシュ管理、バックグラウンド価格監視

const CACHE_NAME = 'rakuten-wallet-v1.0.0';
const CACHE_URLS = [
    './rakuten-wallet-pwa.html',
    './rakuten-app.js',
    './rakuten-manifest.json',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
];

// Service Workerインストール
self.addEventListener('install', (event) => {
    console.log('📦 Service Worker: インストール中...');
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('📦 キャッシュを作成');
                return cache.addAll(CACHE_URLS);
            })
            .then(() => self.skipWaiting())
    );
});

// Service Workerアクティベーション
self.addEventListener('activate', (event) => {
    console.log('✅ Service Worker: アクティブ化');
    
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((cacheName) => cacheName !== CACHE_NAME)
                    .map((cacheName) => {
                        console.log('🗑️ 古いキャッシュを削除:', cacheName);
                        return caches.delete(cacheName);
                    })
            );
        }).then(() => self.clients.claim())
    );
});

// フェッチイベント - ネットワークファースト戦略（リアルタイム価格のため）
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    
    // CoinGecko APIはキャッシュせず常に最新データを取得
    if (event.request.url.includes('api.coingecko.com')) {
        event.respondWith(
            fetch(event.request)
                .catch(() => {
                    return new Response(
                        JSON.stringify({ error: 'オフライン: 価格データを取得できません' }),
                        { headers: { 'Content-Type': 'application/json' } }
                    );
                })
        );
        return;
    }
    
    // その他のリソースはネットワークファースト、フォールバックでキャッシュ
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                if (response && response.status === 200) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return response;
            })
            .catch(() => {
                return caches.match(event.request).then((cachedResponse) => {
                    if (cachedResponse) {
                        return cachedResponse;
                    }
                    
                    if (event.request.mode === 'navigate') {
                        return caches.match('./rakuten-wallet-pwa.html');
                    }
                });
            })
    );
});

// プッシュ通知受信
self.addEventListener('push', (event) => {
    console.log('📬 プッシュ通知を受信');
    
    let notificationData = {
        title: '🛒 楽天ウォレット Pro',
        body: '価格が更新されました',
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23bf0000"/><text x="50" y="65" font-size="60" text-anchor="middle" fill="white">🛒</text></svg>',
        badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><circle cx="48" cy="48" r="48" fill="%23bf0000"/></svg>',
        tag: 'rakuten-notification',
        requireInteraction: false,
        vibrate: [200, 100, 200],
        data: {
            url: './rakuten-wallet-pwa.html'
        },
        actions: [
            { action: 'view', title: '確認する' },
            { action: 'dismiss', title: '閉じる' }
        ]
    };
    
    if (event.data) {
        try {
            const payload = event.data.json();
            notificationData = { ...notificationData, ...payload };
        } catch (e) {
            notificationData.body = event.data.text();
        }
    }
    
    event.waitUntil(
        self.registration.showNotification(notificationData.title, notificationData)
    );
});

// 通知クリック処理
self.addEventListener('notificationclick', (event) => {
    console.log('🔔 通知がクリックされました:', event.action);
    
    event.notification.close();
    
    if (event.action === 'dismiss') {
        return;
    }
    
    const urlToOpen = event.notification.data?.url || './rakuten-wallet-pwa.html';
    
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((windowClients) => {
                for (let client of windowClients) {
                    if (client.url.includes('rakuten-wallet') && 'focus' in client) {
                        return client.focus();
                    }
                }
                
                if (clients.openWindow) {
                    return clients.openWindow(urlToOpen);
                }
            })
    );
});

// バックグラウンド同期
self.addEventListener('sync', (event) => {
    console.log('🔄 バックグラウンド同期:', event.tag);
    
    if (event.tag === 'sync-price-data') {
        event.waitUntil(syncPriceData());
    }
});

// 価格データ同期
async function syncPriceData() {
    try {
        console.log('📡 価格データを同期中...');
        
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=jpy&include_24hr_change=true');
        
        if (response.ok) {
            const data = await response.json();
            
            Object.entries(data).forEach(([coinId, priceData]) => {
                if (priceData.jpy_24h_change && Math.abs(priceData.jpy_24h_change) > 5) {
                    self.registration.showNotification('📊 価格変動アラート', {
                        body: `${coinId}: ${priceData.jpy_24h_change > 0 ? '+' : ''}${priceData.jpy_24h_change.toFixed(2)}%`,
                        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23bf0000"/><text x="50" y="65" font-size="60" text-anchor="middle" fill="white">🛒</text></svg>',
                        tag: `price-change-${coinId}`
                    });
                }
            });
        }
        
        return true;
    } catch (error) {
        console.error('❌ 同期エラー:', error);
        return false;
    }
}

// 定期的なバックグラウンド同期
self.addEventListener('periodicsync', (event) => {
    console.log('⏰ 定期同期:', event.tag);
    
    if (event.tag === 'update-crypto-prices') {
        event.waitUntil(updateCryptoPrices());
    }
});

// 暗号資産価格更新
async function updateCryptoPrices() {
    try {
        console.log('💰 暗号資産価格を更新中...');
        
        const response = await fetch(
            'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,ripple,litecoin&vs_currencies=jpy&include_24hr_change=true'
        );
        
        if (response.ok) {
            const data = await response.json();
            console.log('✅ 価格データ更新完了:', data);
            
            const clients = await self.clients.matchAll();
            clients.forEach(client => {
                client.postMessage({
                    type: 'PRICE_UPDATE',
                    data: data
                });
            });
        }
        
        return true;
    } catch (error) {
        console.error('❌ 価格更新エラー:', error);
        return false;
    }
}

// メッセージ受信（アプリからの通信）
self.addEventListener('message', (event) => {
    console.log('💬 メッセージ受信:', event.data);
    
    if (event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    
    if (event.data.type === 'CACHE_URLS') {
        event.waitUntil(
            caches.open(CACHE_NAME).then((cache) => {
                return cache.addAll(event.data.urls);
            })
        );
    }
    
    if (event.data.type === 'GET_VERSION') {
        event.ports[0].postMessage({ version: CACHE_NAME });
    }
    
    if (event.data.type === 'SET_PRICE_ALERT') {
        console.log('🔔 価格アラート設定:', event.data.alert);
    }
});

// エラーハンドリング
self.addEventListener('error', (event) => {
    console.error('❌ Service Workerエラー:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
    console.error('❌ 未処理のPromise拒否:', event.reason);
});

console.log('🚀 Service Worker起動完了:', CACHE_NAME);
