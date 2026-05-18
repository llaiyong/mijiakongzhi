const API = {
    _token: null,

    getToken() {
        return this._token || this._getCookie("mijia_session");
    },

    setToken(token) {
        this._token = token;
    },

    _getCookie(name) {
        const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
        return match ? match[2] : null;
    },

    _authHeaders() {
        const token = this.getToken();
        return token ? { "X-Auth-Token": token } : {};
    },

    async request(url, options = {}) {
        const headers = { "Content-Type": "application/json", ...this._authHeaders(), ...options.headers };
        const res = await fetch(url, { headers, ...options });

        // 401 未授权 → 跳转登录页
        if (res.status === 401) {
            window.location.hash = "#login";
            return { success: false, require_auth: true };
        }
        // 429 限流
        if (res.status === 429) {
            return { success: false, message: "请求过于频繁，请稍后再试" };
        }
        return res.json();
    },

    // ============ 认证 API ============

    async login(password) {
        return this.request("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({ password }),
        });
    },

    async logout() {
        this._token = null;
        return this.request("/api/auth/logout", { method: "POST" });
    },

    async authStatus() {
        return this.request("/api/auth/status");
    },

    async changePassword(oldPassword, newPassword) {
        return this.request("/api/auth/change-password", {
            method: "POST",
            body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
        });
    },

    // ============ 米家业务 API ============

    async getDevices() {
        return this.request("/api/devices");
    },

    async getQrCode() {
        return this.request("/api/cloud/qr-code", { method: "POST" });
    },

    async checkQrLogin(lp) {
        return this.request("/api/cloud/check-qr-login", {
            method: "POST",
            body: JSON.stringify({ lp }),
        });
    },

    async getLoginStatus() {
        return this.request("/api/cloud/login-status");
    },

    async cloudLogout() {
        return this.request("/api/cloud/logout", { method: "POST" });
    },

    async addLocalDevice(name, ip, token, model) {
        return this.request("/api/devices/local/add", {
            method: "POST",
            body: JSON.stringify({ name, ip, token, model, type: "" }),
        });
    },

    async getDeviceStatus(did, useCloud = false) {
        return this.request(`/api/devices/${did}/status?use_cloud=${useCloud}`);
    },

    async sendAction(did, action, params = {}, useCloud = false) {
        return this.request(`/api/devices/${did}/action`, {
            method: "POST",
            body: JSON.stringify({ action, params, use_cloud: useCloud }),
        });
    },

    async getDeviceSpec(did) {
        return this.request(`/api/devices/${did}/spec`);
    },

    async getConfig() {
        return this.request("/api/config");
    },

    async updateConfig(config) {
        return this.request("/api/config", {
            method: "PUT",
            body: JSON.stringify(config),
        });
    },

    async getHomes() {
        return this.request("/api/homes");
    },

    async syncHomes() {
        return this.request("/api/homes/sync", { method: "POST" });
    },

    async getDeviceStates(dids = "") {
        return this.request(`/api/devices/states${dids ? `?dids=${dids}` : ""}`);
    },
};
