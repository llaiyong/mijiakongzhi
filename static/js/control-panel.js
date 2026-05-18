const CN_NAMES = {
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
    "Physical Control Locked": "童锁",
    "Default Power On State": "通电默认状态",
    "Power Consumption": "功耗", "Power": "功率",
    "Keep Warm Temperature": "保温温度", "Keep Warm Time": "保温时间",
    "Auto Keep Warm": "自动保温", "No Disturb": "勿扰",
    "Cook Mode": "烹饪模式", "Cook Time": "烹饪时间",
    "Water Box Status": "水箱状态",
    "Self Check Results": "自检结果",
};

function cnName(text) {
    if (!text) return "";
    return CN_NAMES[text] || text;
}

function getCurrentValue(siid, piid, properties) {
    if (!properties) return undefined;
    for (const p of properties) {
        if (p.siid === siid && p.piid === piid) {
            return p.value;
        }
    }
    return undefined;
}

function renderControlPanel(device, controls, properties, container) {
    if (!properties) properties = [];
    if (!controls) controls = [];
    container.innerHTML = "";

    const header = document.createElement("div");
    header.className = "device-detail-header";
    header.innerHTML = `
        <span class="device-icon">${device.icon || "📱"}</span>
        <div>
            <div class="device-name">${device.name}</div>
            <div class="device-model">${device.model || device.type} · ${device.mode === "cloud" ? "CLOUD" : "LOCAL"}</div>
        </div>
    `;
    container.appendChild(header);

    const meaningfulProps = properties.filter(p =>
        !["Device Manufacturer", "Device Model", "Device Serial Number", "Device ID", "Current Firmware Version", "Serial Number"].includes(p.name)
    );

    if (meaningfulProps.length > 0) {
        const statusSection = document.createElement("div");
        statusSection.className = "control-panel";
        statusSection.innerHTML = `<h3>设备状态</h3>`;
        meaningfulProps.forEach(p => {
            const row = document.createElement("div");
            row.className = "control-group";
            let displayValue = p.value;
            if (p.format === "bool") displayValue = p.value ? "开启" : "关闭";
            else if (["uint8", "int32", "int16", "float"].includes(p.format)) {
                if (p.name.toLowerCase().includes("temperature") || cnName(p.name).includes("温度")) displayValue = `${p.value}°C`;
                else if (p.name.toLowerCase().includes("humidity") || cnName(p.name).includes("湿度")) displayValue = `${p.value}%`;
                else if (p.name.toLowerCase().includes("battery") || cnName(p.name).includes("电量")) displayValue = `${p.value}%`;
                else if (p.name.toLowerCase().includes("position") || cnName(p.name).includes("位置")) displayValue = `${p.value}%`;
            }
            row.innerHTML = `
                <div>
                    <div class="control-label">${cnName(p.name)}</div>
                </div>
                <div class="control-value">${displayValue}</div>
            `;
            statusSection.appendChild(row);
        });
        container.appendChild(statusSection);
    }

    if (!controls || controls.length === 0) {
        const powerSection = document.createElement("div");
        powerSection.className = "control-panel";
        powerSection.innerHTML = `
            <h3>快捷控制</h3>
            <div class="control-group">
                <div>
                    <div class="control-label">电源开关</div>
                    <div class="control-sublabel">打开或关闭设备</div>
                </div>
                <div style="display:flex;gap:8px;">
                    <button class="btn btn-primary" id="ctrlPowerOn">打开</button>
                    <button class="btn" id="ctrlPowerOff">关闭</button>
                </div>
            </div>
        `;
        container.appendChild(powerSection);

        document.getElementById("ctrlPowerOn").addEventListener("click", async () => {
            try {
                const result = await API.sendAction(device.did, "power_on", {}, device.mode === "cloud");
                if (result.success) {
                    App.showToast("已打开");
                    App.showDeviceDetail(device.did);
                } else {
                    App.showToast("失败: " + (result.error || ""));
                }
            } catch (err) {
                App.showToast("请求失败");
            }
        });
        document.getElementById("ctrlPowerOff").addEventListener("click", async () => {
            try {
                const result = await API.sendAction(device.did, "power_off", {}, device.mode === "cloud");
                if (result.success) {
                    App.showToast("已关闭");
                    App.showDeviceDetail(device.did);
                } else {
                    App.showToast("失败: " + (result.error || ""));
                }
            } catch (err) {
                App.showToast("请求失败");
            }
        });
        return;
    }

    const panel = document.createElement("div");
    panel.className = "control-panel";

    const title = document.createElement("h3");
    title.textContent = "控制面板";
    panel.appendChild(title);

    controls.forEach((ctrl) => {
        const group = document.createElement("div");
        group.className = "control-group";

        const labelDiv = document.createElement("div");
        labelDiv.innerHTML = `<div class="control-label">${cnName(ctrl.name) || "未命名"}</div>`;
        if (ctrl.service_name) {
            labelDiv.innerHTML += `<div class="control-sublabel">${cnName(ctrl.service_name)}</div>`;
        }
        group.appendChild(labelDiv);

        const inputDiv = document.createElement("div");
        inputDiv.style.display = "flex";
        inputDiv.style.alignItems = "center";
        inputDiv.style.gap = "8px";

        const currentValue = getCurrentValue(ctrl.siid, ctrl.piid, properties);

        if (ctrl.control_type === "toggle") {
            const toggle = document.createElement("label");
            toggle.className = "toggle";
            const checked = currentValue === true ? "checked" : "";
            toggle.innerHTML = `<input type="checkbox" data-siid="${ctrl.siid}" data-piid="${ctrl.piid}" ${checked}><span class="slider"></span>`;
            toggle.querySelector("input").addEventListener("change", async (e) => {
                try {
                    const result = await API.sendAction(device.did, "set_property", {
                        siid: ctrl.siid, piid: ctrl.piid, value: e.target.checked
                    }, device.mode === "cloud");
                    if (result.success) {
                        App.showToast("已更新");
                        App.showDeviceDetail(device.did);
                    } else {
                        App.showToast("失败");
                    }
                } catch (err) {
                    App.showToast("请求失败");
                }
            });
            inputDiv.appendChild(toggle);
        } else if (ctrl.control_type === "range") {
            const range = document.createElement("input");
            range.type = "range";
            range.min = ctrl.min;
            range.max = ctrl.max;
            range.step = ctrl.step || 1;
            range.value = currentValue !== undefined ? currentValue : ctrl.min;
            const valSpan = document.createElement("span");
            valSpan.className = "control-value";
            valSpan.textContent = range.value;
            range.addEventListener("input", () => { valSpan.textContent = range.value; });
            range.addEventListener("change", async () => {
                try {
                    const result = await API.sendAction(device.did, "set_property", {
                        siid: ctrl.siid, piid: ctrl.piid, value: parseInt(range.value)
                    }, device.mode === "cloud");
                    if (result.success) {
                        App.showToast("已更新");
                        App.showDeviceDetail(device.did);
                    } else {
                        App.showToast("失败");
                    }
                } catch (err) {
                    App.showToast("请求失败");
                }
            });
            inputDiv.appendChild(range);
            inputDiv.appendChild(valSpan);
        } else if (ctrl.control_type === "select") {
            const select = document.createElement("select");
            select.className = "control-select";
            (ctrl.options || []).forEach((opt) => {
                const option = document.createElement("option");
                option.value = opt.value;
                option.textContent = opt.description || opt.name || opt.value;
                select.appendChild(option);
            });
            if (currentValue !== undefined) {
                select.value = currentValue;
            }
            select.addEventListener("change", async () => {
                try {
                    const result = await API.sendAction(device.did, "set_property", {
                        siid: ctrl.siid, piid: ctrl.piid, value: parseInt(select.value)
                    }, device.mode === "cloud");
                    if (result.success) {
                        App.showToast("已更新");
                        App.showDeviceDetail(device.did);
                    } else {
                        App.showToast("失败");
                    }
                } catch (err) {
                    App.showToast("请求失败");
                }
            });
            inputDiv.appendChild(select);
        } else if (ctrl.control_type === "button") {
            const btn = document.createElement("button");
            btn.className = "btn btn-primary";
            btn.textContent = cnName(ctrl.name) || "执行";
            btn.style.padding = "6px 14px";
            btn.style.fontSize = "13px";
            btn.addEventListener("click", async () => {
                try {
                    const result = await API.sendAction(device.did, "action", {
                        siid: ctrl.siid, aiid: ctrl.aiid
                    }, device.mode === "cloud");
                    if (result.success) {
                        App.showToast("已执行");
                        App.showDeviceDetail(device.did);
                    } else {
                        App.showToast("失败");
                    }
                } catch (err) {
                    App.showToast("请求失败");
                }
            });
            inputDiv.appendChild(btn);
        }

        group.appendChild(inputDiv);
        panel.appendChild(group);
    });

    container.appendChild(panel);
}
