#!/usr/bin/env python3
"""把 LuCI 的 .po 编译成 .lmo。

移植自 openwrt/luci 的 modules/luci-base/src/po2lmo.c 与 src/lib/lmo.c：
  sfh_hash(data, len, init)           —— Paul Hsieh 的 SuperFastHash
  文件布局：[字符串表(value + 4 字节对齐补零)] [索引(每条 16 字节, 大端)] [索引偏移(大端 uint32)]
  索引项：key_id = sfh_hash(msgid, len, len)、val_id = 1、offset、length

**仅供开发与真机装机脚本使用**：正式构建由 luci.mk 调 po2lmo 完成。
用法: tools/po2lmo.py <input.po> <output.lmo>
"""

import re
import struct
import sys

MASK = 0xFFFFFFFF


def _u16(data, off):
    return data[off] | (data[off + 1] << 8)


def _s8(b):
    return b - 256 if b >= 128 else b


def sfh_hash(data: bytes, init: int) -> int:
    """SuperFastHash；第三参数在 C 里是 init（po2lmo 传 len）。"""
    length = len(data)
    if length <= 0:
        return 0

    h = init & MASK
    rem = length & 3
    n = length >> 2
    off = 0

    for _ in range(n):
        h = (h + _u16(data, off)) & MASK
        tmp = ((_u16(data, off + 2) << 11) ^ h) & MASK
        h = ((h << 16) ^ tmp) & MASK
        off += 4
        h = (h + (h >> 11)) & MASK

    if rem == 3:
        h = (h + _u16(data, off)) & MASK
        h = (h ^ (h << 16)) & MASK
        h = (h ^ ((_s8(data[off + 2]) << 18) & MASK)) & MASK
        h = (h + (h >> 11)) & MASK
    elif rem == 2:
        h = (h + _u16(data, off)) & MASK
        h = (h ^ (h << 11)) & MASK
        h = (h + (h >> 17)) & MASK
    elif rem == 1:
        h = (h + _s8(data[off])) & MASK
        h = (h ^ (h << 10)) & MASK
        h = (h + (h >> 1)) & MASK

    h = (h ^ (h << 3)) & MASK
    h = (h + (h >> 5)) & MASK
    h = (h ^ (h << 4)) & MASK
    h = (h + (h >> 17)) & MASK
    h = (h ^ (h << 25)) & MASK
    h = (h + (h >> 6)) & MASK
    return h


def canon_bytes(text: str) -> bytes:
    """对应 lmo_canon_hash 在 ctx=NULL / plural=-1 时的空白折叠与去尾空白。"""
    out = []
    prev_space = True
    for ch in text:
        if ch.isspace():
            if not prev_space:
                out.append(' ')
            prev_space = True
        else:
            out.append(ch)
            prev_space = False

    norm = ''.join(out)
    if norm.endswith(' '):
        norm = norm[:-1]
    return norm.encode('utf-8')


UNESCAPE = {'n': '\n', 't': '\t', 'r': '\r', '"': '"', '\\': '\\'}


def unescape(raw: str) -> str:
    out = []
    i = 0
    while i < len(raw):
        ch = raw[i]
        if ch == '\\' and i + 1 < len(raw):
            out.append(UNESCAPE.get(raw[i + 1], raw[i + 1]))
            i += 2
        else:
            out.append(ch)
            i += 1
    return ''.join(out)


LINE_RE = re.compile(r'^(msgid|msgstr|msgid_plural|msgstr\[(\d+)\])\s+"?(.*?)"?\s*$')


def parse_po(path):
    """返回 [(msgid, msgstr)]，忽略注释与 obsolete 条目；复数只取 msgstr[0]。"""
    entries = []
    cur_key = None
    buf = {'id': [], 'str': [], 'plural': []}

    def flush():
        if not buf['id']:
            return
        msgid = unescape(''.join(buf['id']))
        msgstr = unescape(''.join(buf['str']))
        if not msgstr:
            return

        if msgid == '':
            # 头条目：po2lmo 只保留 Plural-Forms 的值，key_id=0 表示永不参与查表
            m = re.search(r'Plural-Forms:\s*(.+)', msgstr)
            entries.append(('', m.group(1).strip() if m else 'nplurals=1; plural=0;'))
            return

        entries.append((msgid, msgstr))

    with open(path, encoding='utf-8') as fh:
        for raw in fh:
            line = raw.rstrip('\n')

            if not line.strip() or line.startswith('#'):
                continue

            m = LINE_RE.match(line)
            if m:
                kind = m.group(1)
                text = m.group(3)

                if kind == 'msgid':
                    flush()
                    buf = {'id': [], 'str': [], 'plural': []}
                    cur_key = 'id'
                elif kind == 'msgid_plural':
                    cur_key = 'plural'
                elif kind == 'msgstr':
                    cur_key = 'str'

                buf[cur_key].append(text)
                continue

            if line.startswith('"') and cur_key:
                buf[cur_key].append(line.strip().strip('"'))

    flush()
    return entries


def compile_po(entries):
    table = bytearray()
    index = []

    for msgid, msgstr in entries:
        value = msgstr.encode('utf-8')
        if not value:
            continue

        key = canon_bytes(msgid)
        key_id = sfh_hash(key, len(key))
        val_id = 1

        index.append((key_id, val_id, len(table), len(value)))
        table += value
        table += b'\x00' * ((-len(value)) % 4)

    index.sort(key=lambda e: e[0])
    blob = bytes(table)
    for e in index:
        blob += struct.pack('>IIII', *e)
    blob += struct.pack('>I', len(table))
    return blob


def main():
    if len(sys.argv) != 3:
        print(__doc__.strip(), file=sys.stderr)
        return 2

    entries = parse_po(sys.argv[1])
    blob = compile_po(entries)
    with open(sys.argv[2], 'wb') as fh:
        fh.write(blob)

    print('%s -> %s（%d 条，%d 字节）' % (sys.argv[1], sys.argv[2], len(entries), len(blob)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
