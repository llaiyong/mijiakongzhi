function getDevicePowerState(device) {
    const state = App.deviceStates[device.did];
    if (!state || !state.properties) return null;
    for (const p of state.properties) {
        if ((p.siid === 2 && p.piid === 1) || /power|开关|on_off/i.test(p.name)) {
            return p.value;
        }
    }
    return null;
}

function getPowerText(powerValue) {
    if (powerValue === null || powerValue === undefined) return "";
    return powerValue ? "已开启" : "已关闭";
}

function getDeviceIcon(device) {
    const type = (device.type || "").toLowerCase();
    const model = (device.model || "").toLowerCase();
    const iconMap = {
        "light": "💡", "lamp": "💡", "led": "💡",
        "plug": "🔌", "socket": "🔌",
        "fan": "🌀",
        "curtain": "🪟", "blind": "🪟",
        "temp": "🌡️", "thermo": "🌡️", "humidity": "💧",
        "sensor": "📡", "motion": "📡", "door": "🚪",
        "camera": "📷",
        "switch": "🔘",
        "air": "🌬️", "purifier": "🌬️",
        "humid": "💨",
        "heater": "🔥", "ac": "❄️",
        "vacuum": "🧹", "robot": "🧹",
        "lock": "🔒",
        "tv": "📺", "speaker": "🔊",
    };
    for (const [key, icon] of Object.entries(iconMap)) {
        if (type.includes(key) || model.includes(key)) return icon;
    }
    return "📱";
}

function getProperty(device, siid, piid) {
    const state = App.deviceStates[device.did];
    if (!state || !state.properties) return undefined;
    for (const p of state.properties) {
        if (p.siid === siid && p.piid === piid) return p.value;
    }
    return undefined;
}

function findPropertyByName(device, pattern) {
    const state = App.deviceStates[device.did];
    if (!state || !state.properties) return undefined;
    for (const p of state.properties) {
        if (pattern.test(p.name)) return p;
    }
    return undefined;
}

function createDeviceCard(device) {
    const card = document.createElement("div");
    const type = (device.type || "").toLowerCase();
    let content;

    if (type === "light") content = createLightCard(device);
    else if (type === "switch") content = createSwitchCard(device);
    else if (type === "climate" || type === "air") content = createACCard(device);
    else if (type === "curtain") content = createCurtainCard(device);
    else if (type === "fan") content = createFanCard(device);
    else if (type === "plug" || type === "outlet") content = createPlugCard(device);
    else if (type.includes("sensor") || type.includes("temp") || type.includes("humidity")) content = createSensorCard(device);
    else content = createDefaultCard(device);

    card.className = `mijia-card${device.online ? "" : " offline"}`;
    card.dataset.did = device.did;
    card.innerHTML = content;

    // 点击卡片进入详情页（排除操作区域）
    card.addEventListener("click", (e) => {
        if (e.target.closest(".quick-action") || e.target.closest(".more-btn") || e.target.closest("input") || e.target.closest("select") || e.target.closest("button")) return;
        App.showDeviceDetail(device.did);
    });

    // 更多按钮 → 侧滑面板
    const moreBtn = card.querySelector(".more-btn");
    if (moreBtn) {
        moreBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            App.openQuickPanel(device.did);
        });
    }

    // 绑定快捷操作事件
    bindQuickActions(card, device);

    return card;
}

function createCardHeader(device, showMore = true) {
    const icon = getDeviceIcon(device);
    return `
        <div class="card-header">
            <div class="card-header-left">
                <span class="card-device-icon">${icon}</span>
                <div class="card-title">
                    <div class="card-name" title="${device.name}">${device.name}</div>
                    ${device.room_name ? `<div class="card-room">${device.room_name}</div>` : ""}
                </div>
            </div>
            ${showMore ? `<button class="more-btn" title="更多控制">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
            </button>` : ""}
        </div>
    `;
}

function createPowerToggle(powerValue) {
    return `
        <div class="card-power-toggle">
            <span class="power-label">${getPowerText(powerValue) || "离线"}</span>
            <label class="mini-switch">
                <input type="checkbox" ${powerValue === true ? "checked" : ""}>
                <span class="mini-slider"></span>
            </label>
        </div>
    `;
}

// ===== 灯光卡片 =====
function createLightCard(device) {
    const powerValue = getDevicePowerState(device);
    const brightness = getProperty(device, 2, 2);
    const colorTemp = getProperty(device, 2, 3);
    const ctMin = 2700, ctMax = 6500;
    const ctPercent = colorTemp !== undefined ? Math.round(((colorTemp - ctMin) / (ctMax - ctMin)) * 100) : null;

    return `
        ${createCardHeader(device)}
        <div class="card-body">
            <div class="light-status">
                <span class="light-status-text">${powerValue === true ? "已开启" : powerValue === false ? "已关闭" : "离线"}</span>
            </div>
            ${brightness !== undefined ? `
                <div class="light-brightness">
                    <div class="brightness-bar">
                        <div class="brightness-fill" style="width:${brightness}%"></div>
                    </div>
                    <span class="brightness-value">${brightness}%</span>
                </div>
            ` : ""}
            ${ctPercent !== null ? `
                <div class="light-color-temp">
                    <span class="ct-label">色温</span>
                    <span class="ct-value">${colorTemp}K</span>
                </div>
            ` : ""}
        </div>
        ${createPowerToggle(powerValue)}
    `;
}

// ===== 多路开关卡片 =====
function createSwitchCard(device) {
    const powerValue = getDevicePowerState(device);
    const state = App.deviceStates[device.did];
    const channels = [];

    // 查找所有开关属性 (siid>=2, piid=1)
    if (state && state.properties) {
        const switches = state.properties.filter(p => p.siid >= 2 && p.piid === 1 && p.format === "bool");
        for (const sw of switches.slice(0, 4)) { // 最多4路
            const names = ["", "左", "中", "右", "总"];
            const idx = sw.siid - 2;
            const label = idx >= 0 && idx < names.length ? names[idx] : `路${sw.siid}`;
            channels.push({ siid: sw.siid, piid: sw.piid, name: label, value: sw.value });
        }
    }

    // 如果没有找到多路开关，显示默认开关
    if (channels.length === 0) {
        return createDefaultCard(device);
    }

    const channelBtns = channels.map(ch => `
        <button class="channel-btn ${ch.value ? "on" : "off"}" data-siid="${ch.siid}" data-piid="${ch.piid}">
            <span class="channel-label">${ch.name}</span>
            <span class="channel-status">${ch.value ? "开" : "关"}</span>
        </button>
    `).join("");

    return `
        ${createCardHeader(device)}
        <div class="card-body">
            <div class="channel-grid">${channelBtns}</div>
        </div>
    `;
}

// ===== 空调卡片 =====
function createACCard(device) {
    const powerValue = getDevicePowerState(device);
    const targetTemp = getProperty(device, 2, 3) ?? getProperty(device, 2, 4);
    const mode = getProperty(device, 2, 2);
    const currentTemp = findPropertyByName(device, /temperature|温度/i);
    const humidity = findPropertyByName(device, /humidity|湿度/i);
    const fanLevel = findPropertyByName(device, /fan|风速|风力/i);

    const modeMap = { 0: "关", 1: "制冷", 2: "制热", 3: "除湿", 4: "送风", 5: "自动", 6: "智能" };
    const modeLabel = mode !== undefined ? (modeMap[mode] || `模式${mode}`) : "";
    const modeIcon = { "制冷": "❄️", "制热": "🔥", "除湿": "💧", "送风": "🌀", "自动": "🔄", "智能": "🤖" }[modeLabel] || "";

    return `
        ${createCardHeader(device)}
        <div class="card-body">
            <div class="ac-display">
                ${targetTemp !== undefined ? `
                    <div class="ac-temp">
                        <span class="ac-temp-value">${targetTemp}</span>
                        <span class="ac-temp-unit">°C</span>
                    </div>
                ` : ""}
                ${modeLabel ? `<div class="ac-mode">${modeIcon} ${modeLabel}</div>` : ""}
                ${currentTemp ? `<div class="ac-env-temp">室内 ${currentTemp.value}°C</div>` : ""}
                ${humidity ? `<div class="ac-env-humi">湿度 ${humidity.value}%</div>` : ""}
            </div>
        </div>
        ${createPowerToggle(powerValue)}
    `;
}

// ===== 窗帘卡片 =====
function createCurtainCard(device) {
    const position = getProperty(device, 2, 3) ?? getProperty(device, 2, 4);
    const state = App.deviceStates[device.did];
    const motorStatus = findPropertyByName(device, /status|status|电机|状态/i);

    return `
        ${createCardHeader(device)}
        <div class="card-body">
            <div class="curtain-display">
                <div class="curtain-progress">
                    <div class="curtain-progress-bar">
                        <div class="curtain-fill" style="width:${position || 0}%"></div>
                    </div>
                    <span class="curtain-position">${position !== undefined ? `${position}%` : "--"}</span>
                </div>
                ${motorStatus ? `<div class="curtain-motor-status">${motorStatus.value}</div>` : ""}
            </div>
        </div>
        <div class="card-curtain-actions">
            <button class="curtain-action-btn" data-action="open" title="打开">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                <span>打开</span>
            </button>
            <button class="curtain-action-btn" data-action="stop" title="暂停">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                <span>暂停</span>
            </button>
            <button class="curtain-action-btn" data-action="close" title="关闭">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 8A6 6 0 0 1 18 8c0 7 3 9 3 9H3s3-2 3-9"/></svg>
                <span>关闭</span>
            </button>
        </div>
    `;
}

// ===== 风扇卡片 =====
function createFanCard(device) {
    const powerValue = getDevicePowerState(device);
    const fanLevel = findPropertyByName(device, /fan|level|档位|风速/i);
    const mode = findPropertyByName(device, /mode|模式/i);

    return `
        ${createCardHeader(device)}
        <div class="card-body">
            <div class="fan-display">
                <span class="fan-status">
                    ${powerValue === true ? (fanLevel ? `档位 ${fanLevel.value}` : "已开启") : "已关闭"}
                </span>
                ${mode ? `<span class="fan-mode">模式: ${mode.value}</span>` : ""}
            </div>
        </div>
        ${createPowerToggle(powerValue)}
    `;
}

// ===== 插座卡片 =====
function createPlugCard(device) {
    const powerValue = getDevicePowerState(device);
    const power = findPropertyByName(device, /power|功率|功耗/i);

    return `
        ${createCardHeader(device)}
        <div class="card-body">
            <div class="plug-display">
                <span class="plug-status">${powerValue === true ? "已开启" : "已关闭"}</span>
                ${power ? `<span class="plug-power">${power.value}W</span>` : ""}
            </div>
        </div>
        ${createPowerToggle(powerValue)}
    `;
}

// ===== 传感器卡片 =====
function createSensorCard(device) {
    const temp = findPropertyByName(device, /temperature|温度/i);
    const humi = findPropertyByName(device, /humidity|湿度/i);
    const battery = findPropertyByName(device, /battery|电池|电量/i);
    const occupancy = findPropertyByName(device, /occupancy|有人|人体|motion|移动/i);
    const illuminance = findPropertyByName(device, /illuminance|光照|lux/i);

    let metrics = [];
    if (temp) metrics.push({ icon: "🌡️", label: "温度", value: `${temp.value}°C` });
    if (humi) metrics.push({ icon: "💧", label: "湿度", value: `${humi.value}%` });
    if (occupancy) metrics.push({ icon: occupancy.value ? "👤" : "🚫", label: "人体", value: occupancy.value ? "有人" : "无人" });
    if (illuminance) metrics.push({ icon: "☀️", label: "光照", value: `${illuminance.value}lux` });
    if (battery) metrics.push({ icon: "🔋", label: "电量", value: `${battery.value}%` });

    const metricsHTML = metrics.map(m => `
        <div class="metric-item">
            <span class="metric-icon">${m.icon}</span>
            <div class="metric-info">
                <span class="metric-label">${m.label}</span>
                <span class="metric-value">${m.value}</span>
            </div>
        </div>
    `).join("");

    return `
        ${createCardHeader(device, false)}
        <div class="card-body sensor-body">
            <div class="metrics-grid">${metricsHTML || "<div class=\"metric-empty\">暂无数据</div>"}</div>
        </div>
    `;
}

// ===== 默认卡片 =====
function createDefaultCard(device) {
    const powerValue = getDevicePowerState(device);
    return `
        ${createCardHeader(device)}
        <div class="card-body">
            <div class="default-status">
                <span class="default-status-text">${getPowerText(powerValue) || "离线"}</span>
            </div>
        </div>
        ${createPowerToggle(powerValue)}
    `;
}

// ===== 快捷操作绑定 =====
function bindQuickActions(card, device) {
    const did = device.did;
    const useCloud = device.mode === "cloud";

    // 电源开关
    const toggle = card.querySelector(".mini-switch input");
    if (toggle) {
        toggle.addEventListener("change", async (e) => {
            e.stopPropagation();
            const newState = e.target.checked;
            toggle.disabled = true;
            try {
                const result = await API.sendAction(did, newState ? "power_on" : "power_off", {}, useCloud);
                if (result.success) {
                    // 更新本地状态
                    if (!App.deviceStates[did]) App.deviceStates[did] = { properties: [], online: true, last_updated: Date.now() / 1000 };
                    let found = false;
                    for (const p of App.deviceStates[did].properties) {
                        if (p.siid === 2 && p.piid === 1) { p.value = newState; found = true; break; }
                    }
                    if (!found) App.deviceStates[did].properties.push({ siid: 2, piid: 1, name: "开关", format: "bool", value: newState });
                    card.classList.toggle("state-on", newState);
                    card.classList.toggle("state-off", !newState);
                    const label = card.querySelector(".power-label");
                    if (label) label.textContent = getPowerText(newState);
                    App.showToast(newState ? "已开启" : "已关闭");
                } else {
                    e.target.checked = !newState;
                    App.showToast("操作失败");
                }
            } catch (err) {
                e.target.checked = !newState;
                App.showToast("请求失败");
            }
            toggle.disabled = false;
        });
    }

    // 多路开关按钮
    card.querySelectorAll(".channel-btn").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const siid = parseInt(btn.dataset.siid);
            const piid = parseInt(btn.dataset.piid);
            const isOn = btn.classList.contains("on");
            try {
                const result = await API.sendAction(did, "set_property", { siid, piid, value: !isOn }, useCloud);
                if (result.success) {
                    if (!App.deviceStates[did]) App.deviceStates[did] = { properties: [], online: true, last_updated: Date.now() / 1000 };
                    let found = false;
                    for (const p of App.deviceStates[did].properties) {
                        if (p.siid === siid && p.piid === piid) { p.value = !isOn; found = true; break; }
                    }
                    btn.classList.toggle("on");
                    btn.classList.toggle("off");
                    btn.querySelector(".channel-status").textContent = !isOn ? "开" : "关";
                    App.showToast(`${btn.querySelector(".channel-label").textContent} 已${!isOn ? "开" : "关"}`);
                }
            } catch (err) {
                App.showToast("请求失败");
            }
        });
    });

    // 窗帘按钮
    card.querySelectorAll(".curtain-action-btn").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            try {
                const result = await API.sendAction(did, action === "open" ? "power_on" : action === "close" ? "power_off" : "toggle", {}, useCloud);
                if (result.success) {
                    App.showToast(action === "open" ? "正在打开" : action === "close" ? "正在关闭" : "已暂停");
                } else {
                    App.showToast("操作失败");
                }
            } catch (err) {
                App.showToast("请求失败");
            }
        });
    });
}

// ===== 更新卡片状态 =====
function updateCardState(card, state) {
    if (!state || !state.properties) return;
    const did = card.dataset.did;
    const powerProp = state.properties.find(p => (p.siid === 2 && p.piid === 1) || /power|开关|on_off/i.test(p.name));
    const powerValue = powerProp ? powerProp.value : null;

    // 更新电源开关
    const toggle = card.querySelector(".mini-switch input");
    if (toggle) toggle.checked = powerValue === true;
    const label = card.querySelector(".power-label");
    if (label) label.textContent = getPowerText(powerValue);
    card.classList.toggle("state-on", powerValue === true);
    card.classList.toggle("state-off", powerValue === false);

    // 更新亮度
    const brightness = state.properties.find(p => p.siid === 2 && p.piid === 2);
    if (brightness !== undefined) {
        const fill = card.querySelector(".brightness-fill");
        const value = card.querySelector(".brightness-value");
        if (fill) fill.style.width = `${brightness.value}%`;
        if (value) value.textContent = `${brightness.value}%`;
    }

    // 更新窗帘位置
    const position = state.properties.find(p => p.siid === 2 && (p.piid === 3 || p.piid === 4));
    if (position !== undefined) {
        const fill = card.querySelector(".curtain-fill");
        const value = card.querySelector(".curtain-position");
        if (fill) fill.style.width = `${position.value}%`;
        if (value) value.textContent = `${position.value}%`;
    }

    // 更新多路开关
    state.properties.filter(p => p.siid >= 2 && p.piid === 1 && p.format === "bool").forEach(p => {
        const btn = card.querySelector(`.channel-btn[data-siid="${p.siid}"]`);
        if (btn) {
            btn.classList.toggle("on", p.value);
            btn.classList.toggle("off", !p.value);
            const status = btn.querySelector(".channel-status");
            if (status) status.textContent = p.value ? "开" : "关";
        }
    });
}

// ===== 渲染网格（保留兼容） =====
function renderDeviceGrid(devices, container) {
    container.innerHTML = "";
    if (!devices || devices.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                <p>暂无设备</p>
                <p class="hint">添加本地设备或登录云端以获取设备列表</p>
            </div>
        `;
        return;
    }
    devices.forEach((device, index) => {
        const card = createDeviceCard(device);
        card.style.animationDelay = `${index * 50}ms`;
        container.appendChild(card);
    });
}

// ===== 侧滑面板控制渲染 =====
function renderQuickControl(did, ctrl, properties, useCloud) {
    const currentValue = getCurrentValue(ctrl.siid, ctrl.piid, properties);

    if (ctrl.control_type === "toggle") {
        const checked = currentValue === true ? "checked" : "";
        return `
            <div class="quick-control-row">
                <div class="quick-control-label">
                    <span class="qc-name">${ctrl.name || "未命名"}</span>
                    ${ctrl.service_name ? `<span class="qc-sub">${ctrl.service_name}</span>` : ""}
                </div>
                <label class="mini-switch">
                    <input type="checkbox" data-siid="${ctrl.siid}" data-piid="${ctrl.piid}" data-type="set_property" ${checked}>
                    <span class="mini-slider"></span>
                </label>
            </div>
        `;
    } else if (ctrl.control_type === "range") {
        const val = currentValue !== undefined ? currentValue : ctrl.min;
        return `
            <div class="quick-control-row">
                <div class="quick-control-label">
                    <span class="qc-name">${ctrl.name || "未命名"}</span>
                    <span class="qc-value" id="qc-val-${ctrl.siid}-${ctrl.piid}">${val}</span>
                </div>
                <input type="range" class="quick-range" min="${ctrl.min}" max="${ctrl.max}" step="${ctrl.step || 1}" value="${val}" data-siid="${ctrl.siid}" data-piid="${ctrl.piid}" data-type="set_property" oninput="document.getElementById('qc-val-${ctrl.siid}-${ctrl.piid}').textContent=this.value">
            </div>
        `;
    } else if (ctrl.control_type === "select") {
        const options = (ctrl.options || []).map((opt) => `<option value="${opt.value}" ${currentValue === opt.value ? "selected" : ""}>${opt.description || opt.name || opt.value}</option>`).join("");
        return `
            <div class="quick-control-row">
                <div class="quick-control-label">
                    <span class="qc-name">${ctrl.name || "未命名"}</span>
                </div>
                <select class="quick-select" data-siid="${ctrl.siid}" data-piid="${ctrl.piid}" data-type="set_property">${options}</select>
            </div>
        `;
    } else if (ctrl.control_type === "button") {
        return `
            <div class="quick-control-row">
                <div class="quick-control-label">
                    <span class="qc-name">${ctrl.name || "未命名"}</span>
                </div>
                <button class="quick-btn" data-siid="${ctrl.siid}" data-aiid="${ctrl.aiid}" data-type="action">执行</button>
            </div>
        `;
    }
    return "";
}

function bindPanelEvents(container, device) {
    const did = device.did;
    const useCloud = device.mode === "cloud";

    // Toggle 开关
    container.querySelectorAll("input[type='checkbox'][data-type='set_property']").forEach((input) => {
        input.addEventListener("change", async (e) => {
            const siid = parseInt(input.dataset.siid);
            const piid = parseInt(input.dataset.piid);
            const value = e.target.checked;
            try {
                const result = await API.sendAction(did, "set_property", { siid, piid, value }, useCloud);
                if (result.success) {
                    App.showToast("已更新");
                    App.loadDeviceStates();
                } else {
                    e.target.checked = !value;
                    App.showToast("失败: " + (result.error || ""));
                }
            } catch (err) {
                e.target.checked = !value;
                App.showToast("请求失败");
            }
        });
    });

    // Range 滑块
    container.querySelectorAll("input.quick-range[data-type='set_property']").forEach((input) => {
        input.addEventListener("change", async (e) => {
            const siid = parseInt(input.dataset.siid);
            const piid = parseInt(input.dataset.piid);
            const value = parseFloat(input.value);
            try {
                const result = await API.sendAction(did, "set_property", { siid, piid, value }, useCloud);
                if (result.success) {
                    App.showToast("已更新");
                    App.loadDeviceStates();
                } else {
                    App.showToast("失败");
                }
            } catch (err) {
                App.showToast("请求失败");
            }
        });
    });

    // Select 下拉
    container.querySelectorAll("select.quick-select[data-type='set_property']").forEach((select) => {
        select.addEventListener("change", async (e) => {
            const siid = parseInt(select.dataset.siid);
            const piid = parseInt(select.dataset.piid);
            const value = parseInt(select.value);
            try {
                const result = await API.sendAction(did, "set_property", { siid, piid, value }, useCloud);
                if (result.success) {
                    App.showToast("已更新");
                    App.loadDeviceStates();
                } else {
                    App.showToast("失败");
                }
            } catch (err) {
                App.showToast("请求失败");
            }
        });
    });

    // Button 按钮
    container.querySelectorAll("button.quick-btn[data-type='action']").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            const siid = parseInt(btn.dataset.siid);
            const aiid = parseInt(btn.dataset.aiid);
            try {
                const result = await API.sendAction(did, "action", { siid, aiid }, useCloud);
                if (result.success) {
                    App.showToast("已执行");
                    App.loadDeviceStates();
                } else {
                    App.showToast("失败");
                }
            } catch (err) {
                App.showToast("请求失败");
            }
        });
    });
}
