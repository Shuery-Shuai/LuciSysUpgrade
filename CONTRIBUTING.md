# 贡献约定

## 提交规范

`<emoji> <type>(<scope>): <中文简述>`

- 沿用本仓库既有的 emoji + Conventional Commits 风格，**subject 用中文**。
- type：`feat` / `fix` / `docs` / `chore` / `refactor` / `test` / `perf` / `style`。
- scope 白名单：`init` `luci` `backend` `source` `upgrade` `pkg` `ci` `docs` `deps` `tests`。
- 示例：`✨ feat(source): 支持从 .versions.json 发现发行版通道`、
  `🐛 fix(backend): 修正 gmtime 月份偏移`。

## 分支与发布

- 单 `main` 分支 + 短生命周期特性分支，PR 必须过 CI。
- 发布用 tag：`vX.Y.Z`，与 `luci-app-sysupgrade/Makefile` 的 `PKG_VERSION` **保持一致**；
  每次发版递增 `PKG_RELEASE`（同版本重打包时）。
- 产物发布在 GitHub Release（24.10 SDK 出 `.ipk`，25.12/main SDK 出 `.apk`）。

## 许可证规则（GPL-2.0-or-later）

- 本项目按 `GPL-2.0-or-later` 分发，源码文件不强制加头部声明，`LICENSE` 为准。
- **可以**并入 GPL-2.0-only 的代码（例如 `luci-app-attendedsysupgrade`），
  但必须在该文件保留原始版权与许可声明，并在提交信息中说明来源。
- **不要 vendor LuCI 源码**：LuCI 主体是 Apache-2.0，一旦并入整个作品必须切换到 GPLv3，
  会把 GPLv3 的 Installation Information 条款带进固件分发。运行时依赖 LuCI 即可。

## 代码约定

### ucode（后端）

- 模块用顶层 `return { ... }` 导出；**模块间用 dotted require**（`require('lucisysupgrade.util')`），
  库文件必须放在 `root/usr/share/ucode/lucisysupgrade/` 下（ucode 默认搜索路径是 `/usr/share/ucode`）。
- 已踩过的坑，别再踩：
  - 没有 `isNaN()`：用 `n != n` 判定 NaN（`int('abc')` 返回 NaN 且 `type` 是 `double`）。
  - 没有 `strftime()`：用 `gmtime()` 的字段自己格式化；注意 `mon` 是 **1 基**、日期字段是 `mday`。
  - `require()` 不吃绝对路径，也没有 `dofile()`；模块必须放 `/usr/share/ucode/<pkg>/` 并用 dotted require；
    `-L <dir>` 只对调试/测试有意义。
  - `fs.popen(cmd, 'r')` + `fp.close()` 取退出码；命令里用 `2>/dev/null` 抑制 stderr。
- 所有远端读取走 `util.http_get()`（内部是设备自带 curl），不要另起下载实现。
- 读 UCI 前先 `ctx.load(CONFIG)`：rpcd 是常驻进程，显式 reload 才不会被进程内的旧快照骗到。
- 源只有「存在」与「激活」两种状态，**不要再引入 enabled 之类的中间态**：一个被禁用的源
  被设为激活源时，回退逻辑会静默换成别的源，排查成本极高（本项目已经踩过一次）。

### i18n

- 源码里的用户可见字符串一律用**英文 msgid** 并包 `_()`，中文放 `po/zh_Hans/lucisysupgrade.po`；
  menu.d 的标题同样走这套（LuCI 会用应用的 catalog 翻译菜单）。
- 正式构建由 `luci.mk` 调 `po2lmo` 生成 `<app>.<lang>.lmo`；**真机装机脚本**用
  `tools/po2lmo.py`（`po2lmo.c` 的 Python 移植）本地生成，并按运行时语言码同时装
  `lucisysupgrade.zh-cn.lmo` 与 `lucisysupgrade.zh_Hans.lmo`（新旧命名兼容）。

### shell

- POSIX `sh`，`shellcheck` 零告警（配置见 `.shellcheckrc`）。

### LuCI 前端

- `htdocs/luci-static/resources/view/sysupgrade/*.js`，`useTabs` 由 prettier 统一。
- 只通过 rpcd ubus 对象 `lucisysupgrade` 访问后端，不在前端拼命令。
- **浏览器端没有 `sprintf`**：用 `'%s %s'.format(a, b)`（LuCI 的 `String.prototype.format`）。
  这个错误在 Node 静态检查里也能暴露 —— 先跑 `node tests/render-check.mjs`。
- 引用其它模块用 `'require sysupgrade.format as fmt';`：`as` 别名受支持
  （luci.js 的正则 `/^require[ \t]+(\S+)(?:[ \t]+as[ \t]+([a-zA-Z_]\S*))?$/`），
  不写 `as` 时变量名是模块路径把非字母数字换成下划线（`sysupgrade_format`）。

## 测试

- `node tests/render-check.mjs`：**无浏览器渲染检查**。按 luci.js 的规则把视图的
  `'require … as …'` 指令绑成参数（正则与 luci.js 一致），用桩跑 `load()` / `render()` / 事件处理器，
  fixture 取自真机 `ubus call` 的真实输出。它能抓住 `sprintf is not defined` 这类**只有浏览器才暴露**的错误。
- `tests/run-on-device.sh [ssh别名]`：把包内文件同步到路由器 `/tmp`，做全量 `ucode -c` 编译检查，
  并跑 `version / sources / status / check` 三条真机场景（官方源、自有构建站、rtfw）。
- `tests/install-on-device.sh [ssh别名]`：装机（含 i18n 编译），`--uninstall` 卸载。
- `tests/sources-crud.sh [ssh别名]`：真机验证自定义源的增删改与护栏（非法输入、重名、激活源自愈、
  至少保留一条源），会临时改动配置并在结束时用备份还原。
- `tests/m2-state-machine.sh [ssh别名]`：真机验证下载状态机的 5 条分支。**不真下载**（不受 CDN 速度影响）：
  用 `check` 拿候选镜像的 url/size/sha256、用 HEAD 拿 etag/last-modified，再伪造「部分文件 + 状态」，
  断言续传命中、ETag 变化拒绝续传、体积不符判失败、成功路径写完成事件、cleanup 杀进程组。原说明 ——
  续传命中/ETag 变化拒绝续传/sha256 不匹配判失败。做法是构造 `download.json` 与部分文件后调 ubus 断言。
- macOS 打包务必带 `COPYFILE_DISABLE=1 tar --no-xattrs`，否则 `._*` 元数据文件会混进归档。
- 逻辑改动的验收标准：在真机上跑通上述场景，且结论与预期一致（见脚本内注释）。

## 里程碑

| | 内容 | 状态 |
|---|---|---|
| M1 | 检测闭环：源抽象、两种 layout、判据、CLI、rpcd、LuCI 概览页 | 已完成并在真机验证 |
| M2 | 下载与校验（`curl -C -` 续传、`profiles.json.images[].sha256`、`file_size_limits.image`） | 已完成并在真机验证 |
| M3 | 刷写（`sysupgrade -k`）、三态刷写日志、webhook | **暂缓** |
| M4 | 定时检测（`/etc/crontabs/root` 标记块）、ipk+apk 双产物 CI | 待做 |
