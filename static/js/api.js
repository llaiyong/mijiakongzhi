const API = {
    async request(url, options = {}) {
        const res = await fetch(url, {
            headers: { "Content-Type": "application/json" },
            ...options,
        });
        return res.json();
    },

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

    async logout() {
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
