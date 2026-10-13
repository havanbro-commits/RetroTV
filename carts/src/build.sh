#!/bin/sh
# Сборка картриджей Tube TV.  Нужны: SGDK (переменная SGDK), m68k-linux-gnu-gcc, python3 + Pillow.
#   SGDK=/путь/к/SGDK ./build.sh snake ../snake.bin
set -e
G=${SGDK:?укажите путь к SGDK}
GAME=$1; OUT=$2
HERE=$(cd "$(dirname "$0")" && pwd)
B=$HERE/.build/$GAME; rm -rf "$B"; mkdir -p "$B/out"
python3 "$HERE/tools/gfx.py" "$GAME" "$B/gfx.h"
CC=m68k-linux-gnu-gcc
FL="-I$B -I$HERE/common -I$HERE/$GAME -isystem$G/inc -isystem$G/res -DSGDK_GCC -m68000 -Wall -Wextra -Wno-shift-negative-value -Wno-main -Wno-unused-parameter -fno-builtin -ffunction-sections -fdata-sections -fms-extensions -O2 -fomit-frame-pointer"
sed -e "s/SAMPLE PROGRAM                                  /$(printf '%-48s' "TUBE TV $(echo $GAME | tr a-z A-Z)")/g" "$G/src/boot/rom_header.c" > "$B/rom_header.c"
$CC $FL -c "$B/rom_header.c" -o "$B/rom_header.o"
m68k-linux-gnu-objcopy -O binary "$B/rom_header.o" "$B/out/rom_header.bin"
cp "$G/src/boot/sega.s" "$B/sega.s"
( cd "$B" && $CC -x assembler-with-cpp -Wa,--register-prefix-optional,--bitwise-or $FL -c sega.s -o sega.o )
OBJS=""
for f in "$HERE/$GAME"/*.c "$HERE"/common/*.c; do o="$B/$(basename "$f" .c).o"; $CC $FL -c "$f" -o "$o"; OBJS="$OBJS $o"; done
$CC -m68000 -n -T "$G/md.ld" -nostdlib "$B/sega.o" $OBJS "$G/lib/libmd.a" "$G/lib/libgcc.a" -o "$B/rom.out" \
    -Wl,--gc-sections -Wl,--build-id=none -Wl,-z,noexecstack 2>&1 | grep -v "GNU-stack\|deprecated" || true
m68k-linux-gnu-objcopy -O binary "$B/rom.out" "$B/rom.bin"
python3 - "$B/rom.bin" "$OUT" <<'PY'
import sys
d = open(sys.argv[1], 'rb').read()
n = ((len(d) + 131071) // 131072) * 131072
d = d + b'\xff' * (n - len(d))
s = 0
for i in range(0x200, len(d) - 1, 2): s = (s + (d[i] << 8 | d[i + 1])) & 0xffff
d = d[:0x18E] + bytes([s >> 8, s & 255]) + d[0x190:]
open(sys.argv[2], 'wb').write(d); print('ROM', sys.argv[2], len(d), 'байт')
PY
