// Financial ticker data fetched directly from frontend
const FinanceTicker = {
    data: {
        usdToVnd: null,
        binance: [],
        silverPrice: null,
    },
    loading: false,

    async fetchAll() {
        if (this.loading) return;
        this.loading = true;

        try {
            const endpoints = [
                { key: 'usdToVnd', url: 'https://exchange-rates7.p.rapidapi.com/convert?from=USD&to=VND&amount=1', headers: { 'Content-Type': 'application/json', 'x-rapidapi-host': 'exchange-rates7.p.rapidapi.com', 'x-rapidapi-key': '223ded8ee5mshc9c34e8094dd80bp19a5e0jsnbb90d0f1b6e5' } },
                { key: 'binance', url: 'https://binance43.p.rapidapi.com/ticker/24hr', headers: { 'Content-Type': 'application/json', 'x-rapidapi-host': 'binance43.p.rapidapi.com', 'x-rapidapi-key': '223ded8ee5mshc9c34e8094dd80bp19a5e0jsnbb90d0f1b6e5' } },
                { key: 'silverPrice', url: 'https://real-time-metal-prices.p.rapidapi.com/api/v1/radpidhub/silver-price/USD', headers: { 'Content-Type': 'application/json', 'x-rapidapi-host': 'real-time-metal-prices.p.rapidapi.com', 'x-rapidapi-key': '223ded8ee5mshc9c34e8094dd80bp19a5e0jsnbb90d0f1b6e5' } },
            ];

            const responses = await Promise.allSettled(
                endpoints.map(e => fetch(e.url, { headers: e.headers }).then(res => res.json()))
            );

            endpoints.forEach((e, i) => {
                const result = responses[i];
                if (result.status === 'fulfilled') {
                    this.data[e.key] = result.value;
                }
            });

            this.render();
        } catch (e) {
            console.error('Failed to fetch ticker data:', e);
        } finally {
            this.loading = false;
        }
    },

    formatNumber(num) {
        if (typeof num !== 'number') return num;
        return num.toLocaleString('vi-VN');
    },

    formatPrice(price) {
        if (!price) return '---';
        const p = parseFloat(price);
        if (isNaN(p)) return price;
        return this.formatNumber(p);
    },

    render() {
        const el = document.getElementById('financeTickerContent');
        if (!el) return;

        const d = this.data;

        // Exchange rate
        let rateText = '';
        if (d.usdToVnd && d.usdToVnd.result) {
            const rate = parseFloat(d.usdToVnd.result);
            if (!isNaN(rate)) {
                rateText = `USD/VND: ${this.formatNumber(rate)}`;
            }
        }

        // Silver price
        let silverText = '';
        if (d.silverPrice && d.silverPrice.silver_price_usd) {
            silverText = `Bạc: $${this.formatPrice(d.silverPrice.silver_price_usd)}`;
        }

        // Binance: BTC and ETH
        let cryptoText = '';
        if (Array.isArray(d.binance)) {
            const btc = d.binance.find(c => c.symbol === 'BTCUSDT');
            const eth = d.binance.find(c => c.symbol === 'ETHUSDT');
            const parts = [];
            if (btc) {
                const change = parseFloat(btc.priceChangePercent);
                parts.push(`BTC: $${this.formatPrice(btc.lastPrice)} (${change >= 0 ? '+' : ''}${change.toFixed(2)}%)`);
            }
            if (eth) {
                const change = parseFloat(eth.priceChangePercent);
                parts.push(`ETH: $${this.formatPrice(eth.lastPrice)} (${change >= 0 ? '+' : ''}${change.toFixed(2)}%)`);
            }
            cryptoText = parts.join(' | ');
        }

        const text = [rateText, silverText, cryptoText].filter(Boolean).join(' | ');
        el.textContent = text || 'Đang tải dữ liệu thị trường...';
    },
};

document.addEventListener('DOMContentLoaded', () => {
    FinanceTicker.fetchAll();
    setInterval(() => FinanceTicker.fetchAll(), 60000);
});
