#!/bin/sh
# 在本地 Docker 里用官方 SDK 构建两种包格式（25.12 → .apk，24.10 → .ipk）。
# 目的：推送前先验证 Makefile 与打包布局；CI 的矩阵与此等价。
# 用法: tools/build-local.sh           （首次会下载两个 SDK，约需数分钟）
set -eu

REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-/tmp/lsu-build}"
mkdir -p "$WORK"

docker run --rm -v "$WORK:/build" -v "$REPO:/src:ro" debian:bookworm-slim bash -c '
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null
apt-get install -y -qq wget xz-utils zstd ca-certificates make gcc g++ python3 file unzip rsync libncurses-dev >/dev/null

build() {
	v="$1"; url="$2"
	echo "=== SDK $v ==="
	# SDK 缓存放在挂载点，解包与构建都在容器内（macOS bind mount 上解包会失败）
	[ -f "/build/sdk-$v.tar.zst" ] || wget -q -O "/build/sdk-$v.tar.zst" "$url"
	rm -rf "/work/$v" && mkdir -p "/work/$v"
	tar --zstd -xf "/build/sdk-$v.tar.zst" -C "/work/$v" --strip-components=1
	cd "/work/$v"
	rm -rf package/luci-app-sysupgrade
	cp -r /src/luci-app-sysupgrade package/
	./scripts/feeds update -a >/dev/null 2>&1
	./scripts/feeds install -a >/dev/null 2>&1 || true
	make defconfig >/dev/null 2>&1
	if make package/luci-app-sysupgrade/compile V=s >/tmp/build-$v.log 2>&1; then
		echo "  编译成功"
	else
		echo "  编译失败，日志尾部："; tail -25 /tmp/build-$v.log
	fi
	mkdir -p "/build/out-$v"
	find bin -name "luci-app-sysupgrade*" -type f -exec cp -v {} "/build/out-$v/" \; 2>/dev/null | sed "s|^|  |"
	echo "--- /build/out-$v ---"
	ls -l "/build/out-$v" 2>/dev/null | tail -3
}

build 25.12.0 "https://downloads.openwrt.org/releases/25.12.0/targets/x86/64/openwrt-sdk-25.12.0-x86-64_gcc-14.3.0_musl.Linux-x86_64.tar.zst"
build 24.10.6 "https://downloads.openwrt.org/releases/24.10.6/targets/x86/64/openwrt-sdk-24.10.6-x86-64_gcc-13.3.0_musl.Linux-x86_64.tar.zst"
echo "=== 双产物构建结束 ==="
'
