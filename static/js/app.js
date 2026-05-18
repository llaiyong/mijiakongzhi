const App = {
    devices: [],
    currentPage: "devices",
    qrCheckTimer: null,
    qrLpUrl: null,
    homes: [],
    deviceStates: {},
    refreshTimer: null,
    webAuthed: false,

    CN_NAMES: {
        "Device Manufacturer": "设备制造商", "Device Model": "设备型号",
        "Device Serial Number": "设备序列号", "Device ID": "设备ID",
        "Current Firmware Version": "固件版本", "Serial Number": "序列号",
        "Temperature": "温度", "Relative Humidity": "湿度",
        "Battery Level": "电量", "Brightness": "亮度",
        "Color Temperature": "色温", "Mode": "模式",
        "Target Temperature": "目标温度", "On": "开关",
        "Fan Level": "风速档位", "Fault": "故障",
        "Motor Control": "电机控制", "Current Position": "当前位置",
        "Target Position": "目标位置", "Motor Reverse": "电机反转",
        "Illumination": "光照度", "Occupancy Status": "人体状态",
        "Has Someone Duration": "有人时长", "No One Duration": "无人时长",
        "Has Someone Detection Sensitivity": "检测灵敏度",
        "Volume": "音量", "Mute": "静音",
        "Play Control": "播放控制", "Ringtone": "铃声",
        "Microphone": "麦克风", "Text Content": "文本内容",
        "Working Level": "工作档位", "Delay": "延时",
        "Sleep Mode": "睡眠模式", "Indicator Light": "指示灯",
        "Physical Control Locked": "童锁", "No Disturb": "勿扰",
        "Default Power On State": "通电默认状态",
        "Power Consumption": "功耗", "Power": "功率",
        "Cook Mode": "烹饪模式", "Cook Time": "烹饪时间",
        "Water Box Status": "水箱状态", "Self Check Results": "自检结果",
    },

    cnName(text) {
        if (!text) return "";
        return this.CN_NAMES[text] || text;
    },

    async init() {
        this.bindNav();
        this.bindRefresh();
        this.bindAddDevice();
        this.bindBack();
        this.bindSearch();
        this.bindQrLogin();
        this.bindSettings();
        this.bindLogout();
        this.bindQuickPanel();
        this.bindWebAuth();
        await this.checkWebAuth();
    },

    bindQuickPanel() {
        const overlay = document.getElementById("quickPanelOverlay");
        const closeBtn = document.getElementById("quickPanelClose");
        if (closeBtn) closeBtn.addEventListener("click", () => this.closeQuickPanel());
        if (overlay) overlay.addEventListener("click", () => this.closeQuickPanel());
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") this.closeQuickPanel();
        });
    },

    async openQuickPanel(did) {
        const device = this.devices.find((d) => d.did === did);
        if (!device) return;

        const panel = document.getElementById("quickPanel");
        const overlay = document.getElementById("quickPanelOverlay");
        const title = document.getElementById("quickPanelTitle");
        const body = document.getElementById("quickPanelBody");

        title.textContent = device.name;
        body.innerHTML = `<div class="quick-panel-loading">加载中...</div>`;
        overlay.classList.add("active");
        panel.classList.add("active");

        const useCloud = device.mode === "cloud";
        const [statusRes, specRes] = await Promise.all([
            API.getDeviceStatus(did, useCloud),
            API.getDeviceSpec(did),
        ]).catch(() => [{ success: false, properties: [] }, { success: true, controls: [] }]);

        if (statusRes.properties) {
            this.deviceStates[did] = { properties: statusRes.properties, online: true, last_updated: Date.now() / 1000 };
        }

        const properties = statusRes.properties || [];
        const controls = specRes.controls || [];

        const meaningfulProps = properties.filter((p) =>
            !["Device Manufacturer", "Device Model", "Device Serial Number", "Device ID", "Current Firmware Version", "Serial Number"].includes(p.name)
        );

        let html = "";

        if (meaningfulProps.length > 0) {
            html += `<div class="quick-section"><h4 class="quick-section-title">设备状态</h4>`;
            meaningfulProps.forEach((p) => {
                let displayValue = p.value;
                if (p.format === "bool") displayValue = p.value ? "开启" : "关闭";
                else if (p.name.toLowerCase().includes("temperature") || p.name.toLowerCase().includes("温度")) displayValue = `${p.value}°C`;
                else if (p.name.toLowerCase().includes("humidity") || p.name.toLowerCase().includes("湿度")) displayValue = `${p.value}%`;
                html += `<div class="quick-status-row"><span class="quick-status-label">${App.cnName(p.name)}</span><span class="quick-status-value">${displayValue}</span></div>`;
            });
            html += `</div>`;
        }

        if (controls.length > 0) {
            html += `<div class="quick-section"><h4 class="quick-section-title">快捷控制</h4>`;
            controls.forEach((ctrl) => {
                html += renderQuickControl(did, ctrl, properties, useCloud);
            });
            html += `</div>`;
        }

        if (!meaningfulProps.length && !controls.length) {
            html = `<div class="quick-panel-empty">暂无可用控制</div>`;
        }

        body.innerHTML = html;
        bindPanelEvents(body, device);
    },

    closeQuickPanel() {
        const panel = document.getElementById("quickPanel");
        const overlay = document.getElementById("quickPanelOverlay");
        panel.classList.remove("active");
        overlay.classList.remove("active");
        this.loadDeviceStates().then(() => {
            document.querySelectorAll(".simple-device-card").forEach((card) => {
                const did = card.dataset.did;
                if (did && this.deviceStates[did]) {
                    updateCardState(card, this.deviceStates[did]);
                }
            });
        });
    },

    async checkWebAuth() {
        const res = await API.authStatus();
        if (res.authenticated) {
            this.webAuthed = true;
            this.showMainApp();
            this.checkMijiaLogin();
            this.startAutoRefresh();
        } else {
            this.showWebAuthPage();
        }
    },

    showWebAuthPage() {
        document.getElementById("sidebar").style.display = "none";
        document.getElementById("refreshBtn").style.display = "none";
        document.getElementById("logoutBtn").style.display = "none";
        document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));

        let authPage = document.getElementById("page-web-auth");
        if (!authPage) {
            const main = document.querySelector(".content");
            authPage = document.createElement("div");
            authPage.id = "page-web-auth";
            authPage.className = "page active";
            authPage.innerHTML = `
                <div class="web-auth-card">
                    <div class="auth-icon">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    </div>
                    <h2>管理面板登录</h2>
                    <p class="auth-desc">请输入管理员密码以访问米家控制</p>
                    <form id="webAuthForm">
                        <div class="auth-input-group">
                            <input type="password" id="webAuthPassword" placeholder="请输入管理员密码" autocomplete="current-password" required>
                        </div>
                        <button type="submit" class="btn btn-primary btn-lg">登录</button>
                    </form>
                    <div id="webAuthError" class="auth-error" style="display:none;"></div>
                </div>
            `;
            main.appendChild(authPage);
        } else {
            authPage.classList.add("active");
        }

        document.getElementById("webAuthForm").addEventListener("submit", (e) => {
            e.preventDefault();
            this.doWebAuth();
        });
    },

    async doWebAuth() {
        const pwd = document.getElementById("webAuthPassword").value;
        const errorEl = document.getElementById("webAuthError");
        errorEl.style.display = "none";

        const res = await API.login(pwd);
        if (res.success) {
            this.webAuthed = true;
            document.getElementById("page-web-auth")?.classList.remove("active");
            this.showMainApp();
            this.checkMijiaLogin();
            this.startAutoRefresh();
            this.showToast("管理面板登录成功");
        } else {
            errorEl.textContent = res.message || "密码错误";
            errorEl.style.display = "block";
        }
    },

    checkMijiaLogin() {
        API.getLoginStatus().then((status) => {
            if (status.logged_in) {
                this.loggedIn = true;
                this.loadDevices();
                this.loadHomes();
            } else {
                this.showLoginPage();
            }
        }).catch(() => {
            this.showLoginPage();
        });
    },

    showLoginPage() {
        document.getElementById("page-login").classList.add("active");
        document.querySelectorAll(".page:not(#page-login):not(#page-web-auth)").forEach((p) => p.classList.remove("active"));
        document.getElementById("sidebar").style.display = "none";
        document.getElementById("refreshBtn").style.display = "none";
        document.getElementById("logoutBtn").style.display = "none";
    },

    showMainApp() {
        document.getElementById("page-login").classList.remove("active");
        document.getElementById("page-web-auth")?.classList.remove("active");
        document.getElementById("page-devices").classList.add("active");
        document.getElementById("sidebar").style.display = "";
        document.getElementById("refreshBtn").style.display = "";
        document.getElementById("logoutBtn").style.display = "";
    },

    bindNav() {
        document.querySelectorAll(".nav-item").forEach((item) => {
            item.addEventListener("click", () => {
                const page = item.dataset.page;
                this.navigate(page);
                if (page === "devices") this.renderDevices();
            });
        });
    },

    bindRefresh() {
        document.getElementById("refreshBtn").addEventListener("click", () => this.loadDevices());
    },

    bindBack() {
        document.getElementById("backBtn").addEventListener("click", () => this.navigate("devices"));
    },

    bindSearch() {
        document.getElementById("searchInput").addEventListener("input", () => {
            this.renderDevices();
        });
    },

    bindQrLogin() {
        document.getElementById("generateQrBtn").addEventListener("click", () => this.generateQrCode());
    },

    bindWebAuth() {
        document.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && document.activeElement?.id === "webAuthPassword") {
                this.doWebAuth();
            }
        });
    },

    bindLogout() {
        document.getElementById("logoutBtn").addEventListener("click", async () => {
            if (!confirm("确定要退出登录吗？")) return;
            try {
                await API.cloudLogout();
                this.loggedIn = false;
                this.devices = [];
                this.deviceStates = {};
                this.homes = [];
                if (this.refreshTimer) {
                    clearInterval(this.refreshTimer);
                    this.refreshTimer = null;
                }
                this.showLoginPage();
                document.getElementById("qrCodeContainer").innerHTML = `<div class="qr-placeholder"><button class="btn btn-primary btn-lg" id="generateQrBtn">生成登录二维码</button></div>`;
                document.getElementById("qrStatus").className = "qr-status";
                document.getElementById("qrStatus").textContent = "等待生成二维码";
                document.getElementById("generateQrBtn").addEventListener("click", () => this.generateQrCode());
                this.showToast("已退出米家登录");
            } catch (err) {
                this.showToast("退出登录失败");
            }
        });
    },

    navigate(page) {
        document.querySelectorAll(".nav-item").forEach((item) => {
            item.classList.toggle("active", item.dataset.page === page);
        });
        document.querySelectorAll(".page").forEach((p) => {
            if (p.id !== "page-web-auth") {
                p.classList.toggle("active", p.id === `page-${page}`);
            }
        });
        this.currentPage = page;
        if (page === "settings") this.loadSettings();
        if (page === "devices") this.renderDevices();
    },

    async loadDevices() {
        const res = await API.getDevices();
        if (res.success) {
            this.devices = res.devices || [];
            this.loadDeviceStates();
            this.renderDevices();
        }
    },

    renderDevices() {
        const container = document.getElementById("deviceGrid");
        const searchVal = document.getElementById("searchInput")?.value.toLowerCase() || "";

        let filtered = this.devices;
        if (searchVal) {
            filtered = filtered.filter(
                (d) => d.name.toLowerCase().includes(searchVal) || (d.model || "").toLowerCase().includes(searchVal)
            );
        }

        renderDeviceGrid(filtered, container);
    },

    async loadHomes() {
        try {
            const res = await API.getHomes();
            if (res.success && res.homes && res.homes.length > 0) {
                this.homes = res.homes;
            }
        } catch (err) {
            console.error("Load homes error:", err);
        }
    },

    async loadDeviceStates() {
        const cloudDids = this.devices.filter((d) => d.mode === "cloud").map((d) => d.did);
        if (cloudDids.length === 0) return;
        try {
            const res = await API.getDeviceStates(cloudDids.join(","));
            if (res.success) {
                this.deviceStates = { ...this.deviceStates, ...res.states };
            }
        } catch (err) {
            console.error("Load device states error:", err);
        }
    },

    startAutoRefresh() {
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        this.refreshTimer = setInterval(() => {
            if (this.loggedIn && this.currentPage === "devices" && this.devices.length > 0) {
                this.loadDeviceStates().then(() => {
                    document.querySelectorAll(".simple-device-card").forEach((card) => {
                        const did = card.dataset.did;
                        if (did && this.deviceStates[did]) {
                            updateCardState(card, this.deviceStates[did]);
                        }
                    });
                });
            }
        }, 30000);
    },

    async showDeviceDetail(did) {
        const device = this.devices.find((d) => d.did === did);
        if (!device) return;

        this.navigate("detail");
        const detailContainer = document.getElementById("deviceDetail");
        const controlContainer = document.getElementById("controlPanel");
        detailContainer.innerHTML = "";
        controlContainer.innerHTML = "";

        const useCloud = device.mode === "cloud";

        const [statusRes, specRes] = await Promise.all([
            API.getDeviceStatus(did, useCloud),
            API.getDeviceSpec(did),
        ]);

        if (!statusRes.success) {
            this.showToast("获取设备状态失败: " + (statusRes.message || ""));
        }

        if (statusRes.properties) {
            this.deviceStates[did] = {
                properties: statusRes.properties,
                online: true,
                last_updated: Date.now() / 1000,
            };
        }

        const properties = statusRes.properties || [];
        renderControlPanel(device, specRes.controls || [], properties, controlContainer);
    },

    async generateQrCode() {
        const container = document.getElementById("qrCodeContainer");
        const statusEl = document.getElementById("qrStatus");

        statusEl.className = "qr-status waiting";
        statusEl.textContent = "正在生成二维码...";

        try {
            const res = await API.getQrCode();
            if (res.success) {
                if (res.already_logged_in) {
                    statusEl.className = "qr-status success";
                    statusEl.textContent = "已登录，正在加载设备...";
                    this.loggedIn = true;
                    this.showMainApp();
                    this.loadDevices();
                    this.loadHomes();
                    this.showToast("登录成功！");
                    return;
                }

                this.qrLpUrl = res.lp;
                container.innerHTML = `<img src="${res.qrImage}" alt="扫码登录二维码" style="width:240px;height:240px;">`;
                statusEl.className = "qr-status scanning";
                statusEl.textContent = "请打开米家 App 扫描二维码";

                this.startQrCheck();
            } else {
                statusEl.className = "qr-status error";
                statusEl.textContent = res.message || "生成二维码失败";
            }
        } catch (err) {
            statusEl.className = "qr-status error";
            statusEl.textContent = "请求失败，请检查网络连接";
        }
    },

    startQrCheck() {
        this.stopQrCheck();
        let attempts = 0;
        const maxAttempts = 60;

        this.qrCheckTimer = setInterval(async () => {
            if (!this.qrLpUrl) {
                this.stopQrCheck();
                return;
            }

            attempts++;
            const statusEl = document.getElementById("qrStatus");

            try {
                const res = await API.checkQrLogin(this.qrLpUrl);
                if (res.success && res.status === "success") {
                    statusEl.className = "qr-status success";
                    statusEl.textContent = "登录成功，正在加载设备...";
                    this.stopQrCheck();
                    this.loggedIn = true;
                    this.showMainApp();
                    this.loadDevices();
                    this.loadHomes();
                    this.showToast("登录成功！");
                } else if (res.status === "waiting") {
                    statusEl.className = "qr-status scanning";
                    statusEl.textContent = res.message || "等待扫码中...";
                } else {
                    statusEl.textContent = res.message || "检查登录状态...";
                }
            } catch (err) {
                console.error("QR check error:", err);
            }

            if (attempts >= maxAttempts) {
                this.stopQrCheck();
                if (statusEl) {
                    statusEl.className = "qr-status error";
                    statusEl.textContent = "二维码已过期，请重新生成";
                }
            }
        }, 3000);
    },

    stopQrCheck() {
        if (this.qrCheckTimer) {
            clearInterval(this.qrCheckTimer);
            this.qrCheckTimer = null;
        }
    },

    bindAddDevice() {
        document.getElementById("addDeviceForm").addEventListener("submit", async (e) => {
            e.preventDefault();
            const name = document.getElementById("addName").value;
            const ip = document.getElementById("addIp").value;
            const token = document.getElementById("addToken").value;
            const model = document.getElementById("addModel").value;
            const result = document.getElementById("addResult");
            result.className = "result-msg";
            result.style.display = "block";
            result.textContent = "添加中...";

            try {
                const res = await API.addLocalDevice(name, ip, token, model);
                if (res.success) {
                    result.className = "result-msg success";
                    result.textContent = `设备 "${name}" 添加成功`;
                    document.getElementById("addDeviceForm").reset();
                    this.loadDevices();
                    this.showToast("设备添加成功");
                } else {
                    result.className = "result-msg error";
                    result.textContent = "添加失败: " + (res.detail || res.message || "未知错误");
                }
            } catch (err) {
                result.className = "result-msg error";
                result.textContent = "请求失败，请检查网络连接";
            }
        });
    },

    showToast(msg) {
        const toast = document.getElementById("toast");
        toast.textContent = msg;
        toast.classList.add("show");
        setTimeout(() => toast.classList.remove("show"), 2500);
    },

    async loadSettings() {
        try {
            const config = await API.getConfig();
            document.getElementById("defaultControlMode").value = config.default_control_mode || "local";
            document.getElementById("corsOrigins").value = config.cors_origins || "";
        } catch (err) {
            console.error("Load settings error:", err);
        }
    },

    bindSettings() {
        document.getElementById("settingsForm").addEventListener("submit", async (e) => {
            e.preventDefault();
            const result = document.getElementById("settingsResult");
            result.className = "result-msg";
            result.style.display = "block";
            result.textContent = "保存中...";

            const config = {
                default_control_mode: document.getElementById("defaultControlMode").value,
                cors_origins: document.getElementById("corsOrigins").value,
            };

            try {
                const res = await API.updateConfig(config);
                if (res.success) {
                    result.className = "result-msg success";
                    result.textContent = "设置已保存";
                    this.showToast("设置已保存");
                } else {
                    result.className = "result-msg error";
                    result.textContent = "保存失败: " + (res.message || "未知错误");
                }
            } catch (err) {
                result.className = "result-msg error";
                result.textContent = "请求失败，请检查网络连接";
            }
        });
    },
};

document.addEventListener("DOMContentLoaded", () => App.init());
