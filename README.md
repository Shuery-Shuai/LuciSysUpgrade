# luci-app-sysupgrade

检测 ImmortalWrt / OpenWrt 系统更新的 LuCI 应用。**只做检测**：读取本机构建标识，
与配置的发布源比对，给出「有更新 / 已是最新 / 远端更旧（可降级）/ 同版本不同构建 / 无法比较」。

> 当前里程碑：**M1（检测闭环）与 M2（下载 + sha256/体积校验）** 均已在 Banana Pi BPI-R4
> （ImmortalWrt SNAPSHOT，apk-tools 3.0.5）上验证通过：下载 28.8 MB 镜像并与源站公布值比对一致，
> 续传/ETag 变化/sha256 不匹配等分支由 `tests/m2-state-machine.sh` 断言覆盖。
> M4 进行中：**定时任务已落地**（写入 `/etc/crontabs/root` 的受管标记块，块外内容一字不动，
> 见 `tests/scheduler.sh`）；双产物 CI（`.apk` / `.ipk`）已就绪，构建先用 `tools/build-local.sh`
> 在本地 Docker 里验证。**M3（刷写）暂不实现**。

## 它做什么 / 不做什么

| | |
|---|---|
| 做 | 读取本机 `BUILD_ID` / `OPENWRT_BUILD_DATE`，探测远端 `version.buildinfo` / `profiles.json`，判定更新状态 |
| 做 | 多源管理，但**同一时刻只激活一个源**（切换式） |
| 做 | 按 `board_name` 在远端 `profiles.json.supported_devices` 中自动匹配 profile |
| 做 | 下载候选镜像到 `/tmp`（`curl -C -` 续传，续传前比对 ETag/Last-Modified）、按源站 sha256 校验、可取消/清理 |
| 不做 | 调用 `sysupgrade` 刷写（M3 暂缓） |
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

内置三条默认源：**ImmortalWrt 官方**、**OpenWrt 官方**、**RTFW 聚合站（immortalwrt）**；
在「源管理」里可以**自定义新增/删除**任意遵循官方目录结构的静态镜像（标识、名称、地址、布局、系统段），
并可一键套用预设。同一时刻只有一条源处于激活状态。

> 选到与本机不同族的源时（例如设备跑 ImmortalWrt、源是 OpenWrt 官方），探测会给出
> **跨发行版警告**：那属于「换系统」而不是升级，配置文件可能不兼容 —— 常见的后果是刷完配置错乱。

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

LuCI 界面：**系统 → 系统更新**，三个页面（与 FanXpert 的 概览/配置/日志 结构一致）

| 页面 | 作用 |
|---|---|
| 概览 | 状态徽标 + 本机/远端对照 + 判定依据 + 候选镜像 + 镜像下载（进度/取消/续传/删除）+ 全部镜像折叠列表 |
| 设置 | **检测源**（表格内增删、单选激活、预设）与**检测通知**（无人值守档位、**定时任务：每日／每周几／每月几号 + 24 小时制时间**、webhook） |
| 日志 | 检测/源/设置/下载事件（最新在前），**支持按级别、事件类型与内容模糊筛选**；另有下载器原始输出尾部；可刷新与清空 |

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
