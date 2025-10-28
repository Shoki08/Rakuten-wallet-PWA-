// 楽天ウォレット Pro - メインアプリケーション
// PWA機能、価格通知、テクニカル分析を含む

const RAKUTEN_COINS = [
    { id: 'bitcoin', symbol: 'BTC', name: 'ビットコイン', coingeckoId: 'bitcoin' },
    { id: 'ethereum', symbol: 'ETH', name: 'イーサリアム', coingeckoId: 'ethereum' },
    { id: 'bitcoin-cash', symbol: 'BCH', name: 'ビットコインキャッシュ', coingeckoId: 'bitcoin-cash' },
    { id: 'litecoin', symbol: 'LTC', name: 'ライトコイン', coingeckoId: 'litecoin' },
    { id: 'ripple', symbol: 'XRP', name: 'リップル', coingeckoId: 'ripple' },
    { id: 'stellar', symbol: 'XLM', name: 'ステラルーメン', coingeckoId: 'stellar' },
    { id: 'cardano', symbol: 'ADA', name: 'カルダノ', coingeckoId: 'cardano' },
    { id: 'polkadot', symbol: 'DOT', name: 'ポルカドット', coingeckoId: 'polkadot' },
    { id: 'tezos', symbol: 'XTZ', name: 'テゾス', coingeckoId: 'tezos' },
    { id: 'polygon', symbol: 'POL', name: 'ポリゴン', coingeckoId: 'matic-network' },
    { id: 'oasys', symbol: 'OAS', name: 'オアシス', coingeckoId: 'oasys' }
];

let coinData = {};
let priceHistory = {};
let chartInstances = {};
let updateTimer = null;
let countdown = 30;
let fetchAttempts = 0;
let favorites = JSON.parse(localStorage.getItem('rakutenFavorites') || '[]');
let priceAlerts = JSON.parse(localStorage.getItem('priceAlerts') || '{}');
let deferredPrompt = null;

// Service Worker登録
if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
        try {
            const registration = await navigator.serviceWorker.register('rakuten-sw.js');
            console.log('✅ Service Worker登録成功:', registration.scope);
            
            // 通知バナー表示チェック
            if (Notification.permission === 'default') {
                setTimeout(() => {
                    document.getElementById('notification-banner').classList.add('show');
                }, 3000);
            }
        } catch (error) {
            console.error('❌ Service Worker登録失敗:', error);
        }
    });
}

// PWAインストールプロンプト
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    document.getElementById('install-banner').classList.add('show');
});

// インストール完了時
window.addEventListener('appinstalled', () => {
    console.log('✅ PWAインストール完了');
    showNotification('🎉 ホーム画面に追加されました!');
    document.getElementById('install-banner').classList.remove('show');
    deferredPrompt = null;
});

// PWAインストール実行
async function installPWA() {
    if (!deferredPrompt) {
        alert('⚠️ インストールできません');
        return;
    }
    
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
        console.log('✅ ユーザーがインストールを承認');
    } else {
        console.log('❌ ユーザーがインストールを拒否');
    }
    
    deferredPrompt = null;
    document.getElementById('install-banner').classList.remove('show');
}

// 通知許可をリクエスト
async function requestNotificationPermission() {
    if (!('Notification' in window)) {
        alert('❌ このブラウザは通知に対応していません');
        return;
    }
    
    try {
        const permission = await Notification.requestPermission();
        
        if (permission === 'granted') {
            showNotification('✅ 通知が有効になりました!');
            document.getElementById('notification-banner').classList.remove('show');
            
            // テスト通知を送信
            sendTestNotification();
        } else {
            alert('⚠️ 通知が拒否されました');
        }
    } catch (error) {
        console.error('通知許可エラー:', error);
        alert('❌ 通知の設定に失敗しました');
    }
}

// テスト通知
function sendTestNotification() {
    if (Notification.permission === 'granted') {
        new Notification('🛒 楽天ウォレット Pro', {
            body: '価格アラートが有効になりました。目標価格で通知します。',
            icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23bf0000"/><text x="50" y="65" font-size="60" text-anchor="middle" fill="white">🛒</text></svg>',
            badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><circle cx="48" cy="48" r="48" fill="%23bf0000"/></svg>',
            tag: 'test-notification',
            requireInteraction: false
        });
    }
}

// 価格アラートをチェック
function checkPriceAlerts(coin) {
    if (Notification.permission !== 'granted') return;
    if (!priceAlerts[coin.id]) return;
    
    const alert = priceAlerts[coin.id];
    const currentPrice = coin.price;
    
    // 目標価格に到達
    if (alert.targetPrice && !alert.targetTriggered) {
        if ((alert.direction === 'above' && currentPrice >= alert.targetPrice) ||
            (alert.direction === 'below' && currentPrice <= alert.targetPrice)) {
            
            new Notification(`🎯 ${coin.name} 価格アラート`, {
                body: `目標価格に到達: ¥${currentPrice.toLocaleString()}`,
                icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23bf0000"/><text x="50" y="65" font-size="60" text-anchor="middle" fill="white">🛒</text></svg>',
                tag: `alert-${coin.id}`,
                requireInteraction: true
            });
            
            priceAlerts[coin.id].targetTriggered = true;
            localStorage.setItem('priceAlerts', JSON.stringify(priceAlerts));
        }
    }
    
    // 大きな価格変動
    if (alert.changeAlert && Math.abs(coin.change) >= alert.changeThreshold) {
        const lastNotified = alert.lastChangeNotification || 0;
        const now = Date.now();
        
        // 5分以内に同じ通知は送らない
        if (now - lastNotified > 5 * 60 * 1000) {
            new Notification(`📊 ${coin.name} 価格変動`, {
                body: `${coin.change >= 0 ? '上昇' : '下落'}: ${Math.abs(coin.change).toFixed(2)}%`,
                icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23bf0000"/><text x="50" y="65" font-size="60" text-anchor="middle" fill="white">🛒</text></svg>',
                tag: `change-${coin.id}`
            });
            
            priceAlerts[coin.id].lastChangeNotification = now;
            localStorage.setItem('priceAlerts', JSON.stringify(priceAlerts));
        }
    }
}

// 価格アラートを設定
function setPriceAlert(coinId, targetPrice, direction) {
    priceAlerts[coinId] = {
        targetPrice: parseFloat(targetPrice),
        direction: direction,
        targetTriggered: false,
        createdAt: Date.now()
    };
    localStorage.setItem('priceAlerts', JSON.stringify(priceAlerts));
    showNotification('🔔 価格アラートを設定しました');
}

// APIステータス更新
function updateApiStatus(status, message) {
    const statusEl = document.getElementById('api-status');
    statusEl.className = `api-status ${status}`;
    statusEl.innerHTML = `<strong>${message}</strong>`;
}

// エラー表示
function showError(message) {
    document.getElementById('error-container').innerHTML = `
        <div class="error-message">
            <strong>⚠️ エラー</strong><br>${message}<br>
            <button onclick="location.reload()" style="margin-top:8px;padding:6px 12px;background:#c00;color:white;border:none;border-radius:5px;cursor:pointer;">🔄 再読み込み</button>
        </div>
    `;
}

// 通知表示
function showNotification(message) {
    // 画面上部の通知（後で追加する場合）
    console.log('通知:', message);
}

// テクニカル指標計算
function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    const changes = prices.slice(1).map((price, i) => price - prices[i]);
    const gains = changes.slice(-period).map(c => c > 0 ? c : 0);
    const losses = changes.slice(-period).map(c => c < 0 ? -c : 0);
    const avgGain = gains.reduce((a, b) => a + b, 0) / period;
    const avgLoss = losses.reduce((a, b) => a + b, 0) / period;
    return avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
}

function calculateMACD(prices) {
    if (prices.length < 26) return { macd: 0, signal: 0, histogram: 0 };
    const ema12 = calculateEMA(prices, 12);
    const ema26 = calculateEMA(prices, 26);
    const macd = ema12 - ema26;
    return { macd, signal: 0, histogram: macd };
}

function calculateEMA(prices, period) {
    if (prices.length < period) return prices[prices.length - 1];
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b) / period;
    for (let i = period; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
}

function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    return prices.slice(-period).reduce((a, b) => a + b) / period;
}

// シグナル分析
function analyzeSignal(prices, change24h, volume) {
    if (prices.length < 20) {
        return {
            signal: 'データ収集中',
            class: 'hold',
            confidence: 0,
            rsi: 50,
            recommendation: 'データ収集中'
        };
    }
    
    const currentPrice = prices[prices.length - 1];
    const rsi = calculateRSI(prices);
    const macd = calculateMACD(prices);
    const ma20 = calculateSMA(prices, 20);
    const ma50 = calculateSMA(prices, Math.min(50, prices.length));
    
    let buyScore = 0;
    let sellScore = 0;
    let reasons = [];
    
    // RSI分析
    if (rsi < 30) {
        buyScore += 2.5;
        reasons.push('RSI超売られ過ぎ');
    } else if (rsi < 40) {
        buyScore += 1.5;
        reasons.push('RSI売られ気味');
    } else if (rsi > 70) {
        sellScore += 2.5;
        reasons.push('RSI超買われ過ぎ');
    } else if (rsi > 60) {
        sellScore += 1.5;
        reasons.push('RSI買われ気味');
    }
    
    // MACD分析
    if (macd.histogram > 0) {
        buyScore += 1;
    } else {
        sellScore += 1;
    }
    
    // 移動平均分析
    if (ma20 && ma50) {
        if (currentPrice > ma20 && ma20 > ma50) {
            buyScore += 2;
            reasons.push('ゴールデンクロス');
        } else if (currentPrice < ma20 && ma20 < ma50) {
            sellScore += 2;
            reasons.push('デッドクロス');
        }
    }
    
    // 変動率分析
    if (change24h > 8) {
        buyScore += 1.5;
        reasons.push('強い上昇トレンド');
    } else if (change24h > 3) {
        buyScore += 0.5;
    } else if (change24h < -8) {
        sellScore += 1.5;
        reasons.push('強い下降トレンド');
    } else if (change24h < -3) {
        sellScore += 0.5;
    }
    
    let signal, signalClass;
    const totalScore = buyScore + sellScore;
    const confidence = Math.min((totalScore / 10) * 100, 100);
    
    if (buyScore > sellScore + 2) {
        signal = '強い買い';
        signalClass = 'strong-buy';
    } else if (buyScore > sellScore) {
        signal = '買い';
        signalClass = 'buy';
    } else if (sellScore > buyScore + 2) {
        signal = '強い売り';
        signalClass = 'strong-sell';
    } else if (sellScore > buyScore) {
        signal = '売り';
        signalClass = 'sell';
    } else {
        signal = '様子見';
        signalClass = 'hold';
    }
    
    let recommendation = signalClass.includes('buy') ? '📱 楽天ウォレットで購入検討' :
                        signalClass.includes('sell') ? '💰 利確検討' : '⏸️ 様子見推奨';
    
    if (reasons.length > 0) {
        recommendation += ` (${reasons[0]})`;
    }
    
    return {
        signal,
        class: signalClass,
        confidence: confidence.toFixed(0),
        rsi: rsi.toFixed(1),
        macd: macd.macd.toFixed(2),
        ma20: ma20 ? ma20.toFixed(2) : '--',
        recommendation
    };
}

// コインデータ取得
async function fetchCoinData() {
    try {
        updateApiStatus('loading', '📡 データ取得中...');
        
        const ids = RAKUTEN_COINS.map(c => c.coingeckoId).join(',');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(
            `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=jpy&include_24hr_change=true&include_24hr_vol=true`,
            { signal: controller.signal }
        );
        
        clearTimeout(timeoutId);
        
        if (!response.ok) throw new Error(`API Error: ${response.status}`);
        
        const data = await response.json();
        if (Object.keys(data).length === 0) throw new Error('データ取得失敗');
        
        let successCount = 0;
        
        RAKUTEN_COINS.forEach(coin => {
            const priceData = data[coin.coingeckoId];
            if (priceData && priceData.jpy) {
                successCount++;
                const price = priceData.jpy;
                const change = priceData.jpy_24h_change || 0;
                const volume = priceData.jpy_24h_vol || 0;
                
                if (!priceHistory[coin.id]) priceHistory[coin.id] = [];
                priceHistory[coin.id].push(price);
                if (priceHistory[coin.id].length > 100) priceHistory[coin.id].shift();
                
                const analysis = analyzeSignal(priceHistory[coin.id], change, volume);
                
                coinData[coin.id] = {
                    ...coin,
                    price,
                    change,
                    volume,
                    analysis,
                    isFavorite: favorites.includes(coin.id)
                };
                
                // 価格アラートチェック
                checkPriceAlerts(coinData[coin.id]);
            }
        });
        
        if (successCount === 0) throw new Error('有効データなし');
        
        updateApiStatus('success', `✅ ${successCount}/${RAKUTEN_COINS.length} 銘柄取得`);
        updateUI();
        updateSummary();
        document.getElementById('loading').style.display = 'none';
        document.getElementById('coins-container').style.display = 'grid';
        fetchAttempts = 0;
        
    } catch (error) {
        console.error('エラー:', error);
        fetchAttempts++;
        
        if (error.name === 'AbortError') {
            updateApiStatus('error', '⏱️ タイムアウト');
            showError('接続タイムアウト。ネット接続を確認してください。');
        } else if (fetchAttempts >= 3) {
            updateApiStatus('error', '❌ 取得失敗');
            showError('API接続に失敗しました。しばらく待ってから再読み込みしてください。');
        } else {
            updateApiStatus('error', `⚠️ 再試行中 (${fetchAttempts}/3)`);
            setTimeout(fetchCoinData, 3000);
        }
    }
}

// チャート作成
function createChart(canvasId, prices) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    
    if (chartInstances[canvasId]) {
        chartInstances[canvasId].destroy();
    }
    
    const ctx = canvas.getContext('2d');
    chartInstances[canvasId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: prices.map((_, i) => ''),
            datasets: [{
                data: prices,
                borderColor: '#bf0000',
                backgroundColor: 'rgba(191, 0, 0, 0.1)',
                borderWidth: 2,
                tension: 0.4,
                fill: true,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { display: false },
                y: { display: false }
            }
        }
    });
}

// UI更新
function updateUI() {
    const container = document.getElementById('coins-container');
    const sortOrder = document.getElementById('sort-order').value;
    const displayMode = document.getElementById('display-mode').value;
    
    let coins = Object.values(coinData);
    
    if (displayMode === 'buy') {
        coins = coins.filter(c => c.analysis.class.includes('buy'));
    } else if (displayMode === 'sell') {
        coins = coins.filter(c => c.analysis.class.includes('sell'));
    }
    
    if (sortOrder === 'change') {
        coins.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    } else if (sortOrder === 'signal') {
        const order = { 'strong-buy': 0, 'buy': 1, 'hold': 2, 'sell': 3, 'strong-sell': 4 };
        coins.sort((a, b) => order[a.analysis.class] - order[b.analysis.class]);
    } else if (sortOrder === 'volume') {
        coins.sort((a, b) => b.volume - a.volume);
    } else {
        coins.sort((a, b) => a.name.localeCompare(b.name));
    }
    
    container.innerHTML = coins.map((coin) => `
        <div class="coin-card signal-${coin.analysis.class}">
            <div class="coin-header">
                <div>
                    <div class="coin-name">${coin.name}</div>
                    <div class="coin-symbol">${coin.symbol}</div>
                </div>
                <button onclick="toggleFavorite('${coin.id}')" style="background:none;border:none;font-size:1.5em;cursor:pointer;">
                    ${coin.isFavorite ? '⭐' : '☆'}
                </button>
            </div>
            <div class="price-section">
                <div class="price">¥${coin.price.toLocaleString('ja-JP', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                <span class="change ${coin.change >= 0 ? 'positive' : 'negative'}">
                    ${coin.change >= 0 ? '+' : ''}${coin.change.toFixed(2)}% (24h)
                </span>
            </div>
            <div class="signal-badge ${coin.analysis.class}">
                ${coin.analysis.signal}
            </div>
            <div class="indicators">
                <div class="indicator">
                    <div class="indicator-name">RSI</div>
                    <div class="indicator-value">${coin.analysis.rsi}</div>
                </div>
                <div class="indicator">
                    <div class="indicator-name">信頼度</div>
                    <div class="indicator-value">${coin.analysis.confidence}%</div>
                </div>
                <div class="indicator">
                    <div class="indicator-name">MA20</div>
                    <div class="indicator-value">${coin.analysis.ma20}</div>
                </div>
                <div class="indicator">
                    <div class="indicator-name">MACD</div>
                    <div class="indicator-value">${coin.analysis.macd}</div>
                </div>
            </div>
            <div class="chart-container">
                <canvas id="chart-${coin.id}"></canvas>
            </div>
            <div class="recommendation">
                ${coin.analysis.recommendation}
            </div>
        </div>
    `).join('');
    
    setTimeout(() => {
        coins.forEach(coin => {
            if (priceHistory[coin.id] && priceHistory[coin.id].length > 0) {
                createChart(`chart-${coin.id}`, priceHistory[coin.id].slice(-30));
            }
        });
    }, 100);
}

// サマリー更新
function updateSummary() {
    let buyCount = 0, holdCount = 0, sellCount = 0;
    let maxChange = 0;
    let maxChangeCoin = '';
    
    Object.values(coinData).forEach(coin => {
        if (coin.analysis.class.includes('buy')) buyCount++;
        else if (coin.analysis.class.includes('sell')) sellCount++;
        else holdCount++;
        
        if (Math.abs(coin.change) > Math.abs(maxChange)) {
            maxChange = coin.change;
            maxChangeCoin = coin.symbol;
        }
    });
    
    document.getElementById('buy-count').textContent = buyCount;
    document.getElementById('hold-count').textContent = holdCount;
    document.getElementById('sell-count').textContent = sellCount;
    document.getElementById('top-change').textContent = 
        maxChangeCoin ? `${maxChangeCoin} ${maxChange >= 0 ? '+' : ''}${maxChange.toFixed(2)}%` : '-';
}

// お気に入りトグル
function toggleFavorite(coinId) {
    const index = favorites.indexOf(coinId);
    if (index > -1) {
        favorites.splice(index, 1);
    } else {
        favorites.push(coinId);
    }
    localStorage.setItem('rakutenFavorites', JSON.stringify(favorites));
    if (coinData[coinId]) {
        coinData[coinId].isFavorite = favorites.includes(coinId);
    }
    updateUI();
}

// お気に入り表示切り替え
function toggleFavorites() {
    if (favorites.length === 0) {
        alert('お気に入りがありません。☆をタップして追加してください。');
        return;
    }
    const coins = Object.values(coinData).filter(c => c.isFavorite);
    if (coins.length === 0) {
        alert('お気に入りがありません。');
        return;
    }
    // お気に入りのみ表示する機能は後で追加可能
}

// アプリ共有
async function shareApp() {
    const shareData = {
        title: '楽天ウォレット Pro',
        text: 'AI搭載トレーディングシグナル',
        url: window.location.href
    };
    
    try {
        if (navigator.share) {
            await navigator.share(shareData);
        } else {
            await navigator.clipboard.writeText(window.location.href);
            alert('URLをコピーしました');
        }
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error('共有エラー:', err);
        }
    }
}

// カウントダウン開始
function startCountdown() {
    const interval = parseInt(document.getElementById('update-interval').value);
    countdown = interval;
    
    if (updateTimer) clearInterval(updateTimer);
    
    updateTimer = setInterval(() => {
        countdown--;
        document.getElementById('countdown').textContent = countdown;
        
        if (countdown <= 0) {
            fetchCoinData();
            document.getElementById('update-time').textContent = new Date().toLocaleString('ja-JP');
            countdown = interval;
        }
    }, 1000);
}

// イベントリスナー設定
document.getElementById('update-interval').addEventListener('change', startCountdown);
document.getElementById('sort-order').addEventListener('change', updateUI);
document.getElementById('display-mode').addEventListener('change', updateUI);
document.getElementById('refresh-btn').addEventListener('click', () => {
    fetchCoinData();
    document.getElementById('update-time').textContent = new Date().toLocaleString('ja-JP');
    startCountdown();
});

// アプリ起動時
window.addEventListener('load', () => {
    fetchCoinData();
    document.getElementById('update-time').textContent = new Date().toLocaleString('ja-JP');
    startCountdown();
});

console.log('🚀 楽天ウォレット Pro 起動完了');
