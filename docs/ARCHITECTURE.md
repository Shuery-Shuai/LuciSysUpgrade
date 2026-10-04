# 架构

## 组件

```
LuCI 视图 (JS)                     CLI
htdocs/.../view/sysupgrade/        root/usr/bin/lucisysupgrade
        │  ubus                        │
        ▼                              ▼
rpcd ucode 对象                  同一套库
root/usr/share/rpcd/ucode/       root/usr/share/ucode/lucisysupgrade/*.uc
lucisysupgrade                        │
        └──────────────┬──────────────┘
                       ▼
        util.uc（curl 取文本）  local.uc（本机标识）
        source.uc（源探测）     verdict.uc（判定）  state.uc（/tmp 缓存）
                       │
                       ▼
        <源>/…/version.buildinfo、profiles.json、.versions.json
```

前端只经 rpcd ubus 对象访问后端（ACL：`ubus.lucisysupgrade.*` + `uci.lucisysupgrade`），
不在前端拼命令，也不给前端任意文件读写权限。

## 数据流（M1）

1. `local.identity()` 读 `/usr/lib/os-release` 与 `/tmp/sysinfo/*` →
   `board_name`、`board_path`（`mediatek/filogic`）、`BUILD_ID`、`OPENWRT_BUILD_DATE`、`version_kind`。
2. `config.load()` 读 UCI，得到源列表与**唯一激活源**（`active_source` 失效时回退到第一个启用的源）。
3. `source.discover()` 取 `<base>/.versions.json`：成功则通道列表 = `snapshots` + 每个 `releases/<ver>`；
   失败则回退 `['snapshots']`；`bin_targets_root` 布局直接返回 `['current']`。
4. `source.pick_channel()` 通道跟随本机：snapshot 看 `snapshots`；release 看同版本线的最新 release。
5. `source.probe()` 读 `version.buildinfo` 与 `profiles.json`，用 `supported_devices` 匹配 profile
   （回退：`board_name` 的 `,`→`_`），并从 `images[]` 里挑 `type=sysupgrade` + `filesystem=squashfs` 的候选。
6. `verdict.compare()` 先比身份（`BUILD_ID` vs `version.buildinfo`），再定方向
   （release 用 `version_number` 语义比较；snapshot 用 `source_date_epoch` ↔ `OPENWRT_BUILD_DATE`）。
7. 结果写入 `/tmp/lucisysupgrade.last.json`，供 `status` 与 UI 在离线时展示（带时间戳）。

## 判定状态

| state | 含义 | 触发条件 |
|---|---|---|
| `same` | 已是最新 | 两侧构建标识相同 |
| `update` | 有可用更新 | 远端版本更高 / 远端源码更新 |
| `downgrade` | 远端更旧（可降级） | 远端版本更低 / 远端源码更旧 |
| `rebuild` | 同版本、不同构建 | 版本号或源码时间相同但构建标识不同 |
| `incomparable` | 无法比较 | 探测失败或缺少可比字段 |

## 状态与幂等（M2 预留）

- 持久配置：`/etc/config/lucisysupgrade`（随 `sysupgrade -k` 备份）。
- 运行态：`/tmp`（`lucisysupgrade.last.json`；后续下载临时文件同样放 `/tmp`，掉电即丢，天然幂等）。
- M3 暂缓：刷写三态日志（`downloaded → flash-pending → boot-confirmed`）与 webhook 事件。

## 不做的事

- 不使用 HTTP `Last-Modified`、文件 mtime、文件名里的日期作为更新判据（原因见 `SOURCE-CONTRACT.md`）。
- 不碰原生 `view/system/flash.js`，不接管系统刷写入口。
