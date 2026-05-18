// ===== 极简设备卡片 =====

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

function createDeviceCard(device) {
    const card = document.createElement("div");
    card.className = `simple-device-card${device.online ? "" : " offline"}`;
    card.dataset.did = device.did;

    const icon = getDeviceIcon(device);
    const powerValue = getDevicePowerState(device);
    const isOn = powerValue === true;

    card.innerHTML = `
        <div class="sdc-icon" title="点击${isOn ? "关闭" : "开启"}">${icon}</div>
        <div class="sdc-name" title="长按更多操作">${device.name}</div>
        <label class="sdc-switch ${isOn ? "on" : ""}">
            <input type="checkbox" ${isOn ? "checked" : ""}>
            <span class="sdc-slider"></span>
        </label>
    `;

    // 点击图标 → 切换电源
    card.querySelector(".sdc-icon").addEventListener("click", async (e) => {
        e.stopPropagation();
        await toggleDevicePower(device, card);
    });

    // 开关切换
    card.querySelector(".sdc-switch input").addEventListener("change", async (e) => {
        e.stopPropagation();
        const targetOn = e.target.checked;
        e.target.disabled = true;
        const result = await API.sendAction(device.did, targetOn ? "power_on" : "power_off", {}, device.mode === "cloud");
        if (!result.success) {
            e.target.checked = !targetOn;
            card.querySelector(".sdc-switch").classList.toggle("on", !targetOn);
            App.showToast("操作失败");
        }
        e.target.disabled = false;
    });

    // 长按设备名 → 更多操作
    let pressTimer;
    const nameEl = card.querySelector(".sdc-name");
    nameEl.addEventListener("mousedown", () => { pressTimer = setTimeout(() => App.openQuickPanel(device.did), 600); });
    nameEl.addEventListener("mouseup", () => clearTimeout(pressTimer));
    nameEl.addEventListener("mouseleave", () => clearTimeout(pressTimer));
    nameEl.addEventListener("touchstart", () => { pressTimer = setTimeout(() => App.openQuickPanel(device.did), 600); }, { passive: true });
    nameEl.addEventListener("touchend", () => clearTimeout(pressTimer));

    // 点击卡片空白 → 详情页
    card.addEventListener("click", (e) => {
        if (e.target.closest(".sdc-icon") || e.target.closest(".sdc-switch")) return;
        App.showDeviceDetail(device.did);
    });

    return card;
}

async function toggleDevicePower(device, card) {
    const input = card.querySelector(".sdc-switch input");
    const targetOn = !input.checked;
    input.disabled = true;
    try {
        const result = await API.sendAction(device.did, targetOn ? "power_on" : "power_off", {}, device.mode === "cloud");
        if (result.success) {
            input.checked = targetOn;
            card.querySelector(".sdc-switch").classList.toggle("on", targetOn);
            App.showToast(targetOn ? "已开启" : "已关闭");
        } else {
            App.showToast("操作失败");
        }
    } catch (err) {
        App.showToast("请求失败");
    }
    input.disabled = false;
}

function updateCardState(card, state) {
    if (!state || !state.properties) return;
    const powerProp = state.properties.find(p => (p.siid === 2 && p.piid === 1) || /power|开关|on_off/i.test(p.name));
    if (!powerProp) return;
    const isOn = powerProp.value === true;
    const input = card.querySelector(".sdc-switch input");
    if (input && !input.disabled) {
        input.checked = isOn;
        card.querySelector(".sdc-switch").classList.toggle("on", isOn);
    }
}

// ===== 房间卡片 =====

const ROOM_ICONS = {
    "客厅": "🛋️", "卧室": "🛏️", "主卧": "🛏️", "次卧": "🛏️",
    "厨房": "🍳", "餐厅": "🍽️", "书房": "📚", "阳台": "☀️",
    "卫生间": "🚿", "走廊": "🚶", "玄关": "🚪",
    "未分组": "📦", "其他设备": "🔧",
};

function getRoomIcon(roomName) {
    for (const [key, icon] of Object.entries(ROOM_ICONS)) {
        if (roomName.includes(key)) return icon;
    }
    return "🏠";
}

function createRoomCard(roomName, devices) {
    const roomCard = document.createElement("div");
    roomCard.className = "room-card";
    roomCard.dataset.room = roomName;

    const icon = getRoomIcon(roomName);
    const onlineCount = devices.filter(d => d.online !== false).length;
    const totalDevices = devices.length;

    roomCard.innerHTML = `
        <div class="room-left">
            <span class="room-icon">${icon}</span>
            <div class="room-info">
                <span class="room-name">${roomName}</span>
                <span class="room-sub">${totalDevices} 个设备${onlineCount < totalDevices ? "，" + onlineCount + " 个在线" : ""}</span>
            </div>
        </div>
        <div class="room-right">
            <span class="room-badge">${onlineCount}/${totalDevices}</span>
            <span class="room-arrow">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
            </span>
        </div>
        <div class="room-devices" style="display:none;">
        </div>
    `;

    // 点击展开/收起
    roomCard.addEventListener("click", (e) => {
        if (e.target.closest(".sdc-switch") || e.target.closest(".sdc-icon")) return;
        const devicesContainer = roomCard.querySelector(".room-devices");
        const arrow = roomCard.querySelector(".room-arrow svg");
        const isExpanded = devicesContainer.style.display !== "none";

        if (isExpanded) {
            devicesContainer.style.display = "none";
            arrow.style.transform = "rotate(0deg)";
            roomCard.classList.remove("expanded");
        } else {
            devicesContainer.style.display = "grid";
            arrow.style.transform = "rotate(180deg)";
            roomCard.classList.add("expanded");
            // 首次展开时渲染设备
            if (devicesContainer.children.length === 0) {
                devices.forEach((device, index) => {
                    const card = createDeviceCard(device);
                    card.style.animationDelay = `${index * 30}ms`;
                    devicesContainer.appendChild(card);
                });
            }
        }
    });

    return roomCard;
}

function updateRoomDeviceStates(roomCard) {
    roomCard.querySelectorAll(".simple-device-card").forEach(card => {
        const did = card.dataset.did;
        if (did && App.deviceStates[did]) {
            updateCardState(card, App.deviceStates[did]);
        }
    });
}

// ===== 渲染 =====

function renderDeviceGrid(devices, container) {
    container.innerHTML = "";
    if (!devices || devices.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                <p>暂无设备</p>
                <p class="hint">添加本地设备或登录云端以获取设备列表</p>
            </div>`;
        return;
    }

    // 按房间分组
    const groups = {};
    devices.forEach(d => {
        const room = d.room_name || (d.mode === "local" ? "其他设备" : "未分组");
        if (!groups[room]) groups[room] = [];
        groups[room].push(d);
    });

    // 排序：有房间名的在前，"其他设备"和"未分组"在后
    const sortedRooms = Object.keys(groups).sort((a, b) => {
        const aSpecial = a === "其他设备" || a === "未分组";
        const bSpecial = b === "其他设备" || b === "未分组";
        if (aSpecial && !bSpecial) return 1;
        if (!aSpecial && bSpecial) return -1;
        return a.localeCompare(b, "zh");
    });

    // 渲染房间卡片
    const roomsContainer = document.createElement("div");
    roomsContainer.className = "rooms-grid";

    sortedRooms.forEach(roomName => {
        const roomCard = createRoomCard(roomName, groups[roomName]);
        roomsContainer.appendChild(roomCard);
    });

    container.appendChild(roomsContainer);
}
