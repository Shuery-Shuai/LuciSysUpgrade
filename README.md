# luci-app-sysupgrade

检测 ImmortalWrt / OpenWrt 系统更新的 LuCI 应用。**只做检测**：读取本机构建标识，
与配置的发布源比对，给出「有更新 / 已是最新 / 远端更旧（可降级）/ 同版本不同构建 / 无法比较」。

> 当前里程碑：**M1（检测闭环）** 已在 Banana Pi BPI-R4（ImmortalWrt SNAPSHOT，apk-tools 3.0.5）上验证通过。
> M2（下载与校验）、M4（定时检测 + 双产物 CI）待做；**M3（刷写）暂不实现**。

## 它做什么 / 不做什么

| | |
|---|---|
| 做 | 读取本机 `BUILD_ID` / `OPENWRT_BUILD_DATE`，探测远端 `version.buildinfo` / `profiles.json`，判定更新状态 |
| 做 | 多源管理，但**同一时刻只激活一个源**（切换式） |
| 做 | 按 `board_name` 在远端 `profiles.json.supported_devices` 中自动匹配 profile |
| 不做 | 下载镜像、校验镜像、调用 `sysupgrade`、改动配置（M3 暂缓） |
| 不做 | 依赖任何非官方字段（不读 HTTP `Last-Modified`、不读文件 mtime、不解析文件名日期） |

## 判据

| 用途 | 本机字段 | 远端字段 |
|---|---|---|
| 身份（是否同一构建） | `/usr/lib/os-release` → `BUILD_ID` | `<dir>/version.buildinfo` |
| 方向（谁更新） | `OPENWRT_BUILD_DATE`（= `SOURCE_DATE_EPOCH`） | `profiles.json` → `source_date_epoch` |
| 方向（发行版通道） | `VERSION`（如 `25.12.2`） | `profiles.json` → `version_number` |
| 通道发现 | — | 根 `/.versions.json`（官方格式，可选） |

**为什么不用发布时间**：实测 `rtfw.shuery.lssa.fun` 的 immortalwrt 快照发布于 2026-10-02（最新），
但其源码是上游 2026-07-06 的提交；而设备跑的是 2026-09-29 的源码。
按发布时间判定会**推荐用户降级**。详见 `docs/SOURCE-CONTRACT.md`。

## 源与布局

| layout | 路径模板 | 例子 |
|---|---|---|
| `official` | `<base>[/<system>]/{snapshots\|releases/<ver>}/targets/<target>/<subtarget>/` | `https://downloads.immortalwrt.org` |
| `bin_targets_root` | `<base>[/<system>]/targets/<target>/<subtarget>/` | `https://immortalwrt.shuery.lssa.fun` |

## 安装

```sh
# SDK 内
./scripts/feeds update -a && ./scripts/feeds install luci-base
cp -r luci-app-sysupgrade package/
make package/luci-app-sysupgrade/compile V=s
```

产物：`bin/packages/*/base/luci-app-sysupgrade_*.{ipk,apk}`（24.10 SDK → ipk；25.12/main SDK → apk）。

## 使用

```sh
lucisysupgrade status            # 本机标识 + 最近一次检测结果
lucisysupgrade sources           # 已配置的源与激活源
lucisysupgrade check             # 检测（激活源）
lucisysupgrade check --source rtfw --json
```

LuCI 界面：**系统 → 系统更新**，三个页面

| 页面 | 作用 |
|---|---|
| 更新检测 | 状态徽标 + 本机/远端对照 + 判定依据 + 候选镜像；含「检查更新」按钮与全部镜像折叠列表 |
| 源管理 | 单选激活源并保存（切换即作废上一源的结果，避免结论来源不一致） |
| 设置 | 无人值守档位 0/1/2、检测间隔、webhook（M3/M4 生效） |

配置：`/etc/config/lucisysupgrade`（`unattended` 0/1/2，默认 0 = 仅检测并通知）。

## 开发与测试

```sh
# 只读验证：同步到路由器 /tmp 并跑 M1 闭环（无需 root）
sh tests/run-on-device.sh ppuc

# 装机验证：安装到系统（走 root 的 ssh 通道，映射同 luci.mk：htdocs/ → /www/）
sh tests/install-on-device.sh ppuc
sh tests/install-on-device.sh --uninstall ppuc     # 卸载

node --check luci-app-sysupgrade/htdocs/luci-static/resources/view/sysupgrade/overview.js
```

## 许可证

GPL-2.0-or-later，见 `LICENSE`。约定见 `CONTRIBUTING.md`。
