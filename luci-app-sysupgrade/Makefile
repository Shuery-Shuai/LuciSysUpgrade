include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-sysupgrade
PKG_VERSION:=0.1.0_alpha1
PKG_RELEASE:=1

PKG_LICENSE:=GPL-2.0-or-later
PKG_MAINTAINER:=Shuery-Shuai <2463253700@qq.com>

LUCI_TITLE:=LuCI app to detect ImmortalWrt/OpenWrt system updates
LUCI_DESCRIPTION:=Detects available ImmortalWrt/OpenWrt updates for the running \
 device by comparing official build metadata (BUILD_ID / OPENWRT_BUILD_DATE) \
 against a configured release source.
LUCI_DEPENDS:=+luci-base +rpcd +rpcd-mod-ucode +curl
LUCI_PKGARCH:=all

define Package/luci-app-sysupgrade/conffiles
/etc/config/lucisysupgrade
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
