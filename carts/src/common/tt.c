#include "tt.h"

void tt_init(const u32 *font, u16 fontTiles)
{
    VDP_setScreenWidth320();
    VDP_setPlaneSize(64, 32, TRUE);
    VDP_setScrollingMode(HSCROLL_PLANE, VSCROLL_PLANE);
    VDP_loadTileData(font, TT_FONT_BASE, fontTiles, DMA);
    PSG_reset();
    tt_music_stop();
}

/* код символа → номер тайла шрифта; кириллица в UTF-8, строчные → прописные */
static const char *next_glyph(const char *s, u16 *tile)
{
    u8 c = (u8) *s++;
    u16 idx = 0;
    if (c < 0x80) {
        if (c >= 'a' && c <= 'z') c -= 32;
        if (c >= 32 && c < 96) idx = c - 32;
    } else if ((c == 0xD0 || c == 0xD1) && *s) {
        u8 c2 = (u8) *s++;
        u16 cp = ((c & 0x1F) << 6) | (c2 & 0x3F);
        if (cp >= 0x430 && cp <= 0x44F) cp -= 0x20;          // строчные
        if (cp == 0x451) cp = 0x401;                          // ё
        if (cp >= 0x410 && cp <= 0x42F) idx = 64 + (cp - 0x410);
        else if (cp == 0x401) idx = 64 + 32;                  // Ё
    }
    *tile = idx;
    return s;
}

u16 tt_len(const char *s)
{
    u16 n = 0, t;
    while (*s) { s = next_glyph(s, &t); n++; }
    return n;
}

void tt_text(VDPPlane plane, const char *s, u16 x, u16 y, u16 pal, u16 prio)
{
    u16 t;
    while (*s) {
        s = next_glyph(s, &t);
        VDP_setTileMapXY(plane, TILE_ATTR_FULL(pal, prio, 0, 0, TT_FONT_BASE + t), x++, y);
    }
}

void tt_textc(VDPPlane plane, const char *s, u16 y, u16 pal, u16 prio)
{
    u16 n = tt_len(s);
    tt_text(plane, s, (40 - n) / 2, y, pal, prio);
}

void tt_num(VDPPlane plane, u32 v, u16 digits, u16 x, u16 y, u16 pal, u16 prio)
{
    char buf[12];
    s16 i;
    for (i = digits - 1; i >= 0; i--) { buf[i] = '0' + (v % 10); v /= 10; }
    buf[digits] = 0;
    tt_text(plane, buf, x, y, pal, prio);
}

void tt_clear_row(VDPPlane plane, u16 y)
{
    VDP_fillTileMapRect(plane, 0, 0, y, 40, 1);
}

u16 tt_rand(u16 n) { return n ? (random() % n) : 0; }

/* ---------- звук ---------- */
typedef struct { u16 f0, f1; u8 frames, left, vol; } Sfx;
static Sfx sfx[3];
static u8 noiseLeft, noiseFrames, noiseVol;
static const TTNote *mus[2], *musStart[2];
static u8 musLeft[2];
static bool musLoop, musOn;

void tt_sfx(u8 ch, u16 f0, u16 f1, u8 frames, u8 vol)
{
    if (ch > 2) return;
    sfx[ch].f0 = f0; sfx[ch].f1 = f1; sfx[ch].frames = frames; sfx[ch].left = frames; sfx[ch].vol = vol;
}

void tt_noise(u8 frames, u8 vol, u8 type, u8 rate)
{
    noiseFrames = frames; noiseLeft = frames; noiseVol = vol;
    PSG_setNoise(type, rate);
}

void tt_music(const TTNote *mel, const TTNote *bass, bool loop)
{
    musStart[0] = mus[0] = mel; musStart[1] = mus[1] = bass;
    musLeft[0] = musLeft[1] = 0; musLoop = loop; musOn = TRUE;
}

void tt_music_stop(void)
{
    musOn = FALSE;
    for (u8 c = 0; c < 4; c++) PSG_setEnvelope(c, PSG_ENVELOPE_MIN);
    for (u8 c = 0; c < 3; c++) sfx[c].left = 0;
    noiseLeft = 0;
}

void tt_sound_update(void)
{
    for (u8 c = 0; c < 3; c++) {
        Sfx *s = &sfx[c];
        if (s->left) {
            u16 k = s->frames - s->left;
            s32 f = s->f0 + ((s32) (s->f1 - s->f0) * k) / s->frames;
            PSG_setFrequency(c, f);
            u8 att = s->vol + (k * (15 - s->vol)) / s->frames;   // затухание
            PSG_setEnvelope(c, att > 15 ? 15 : att);
            if (--s->left == 0) PSG_setEnvelope(c, PSG_ENVELOPE_MIN);
            continue;
        }
        if (musOn && c < 2 && mus[c]) {
            if (musLeft[c] == 0) {
                if (mus[c]->len == 0) {                       // конец мелодии
                    if (musLoop) mus[c] = musStart[c]; else { mus[c] = 0; PSG_setEnvelope(c, PSG_ENVELOPE_MIN); continue; }
                }
                musLeft[c] = mus[c]->len;
                if (mus[c]->f) PSG_setFrequency(c, mus[c]->f);
                mus[c]++;
            }
            const TTNote *cur = mus[c] - 1;
            u8 played = cur->len - musLeft[c];
            u8 att = cur->f ? (c ? 5 : 3) + (played > 6 ? 6 : played) : 15;   // мягкая атака и спад
            if (musLeft[c] == 1) att = 15;                                       // разделяем ноты
            PSG_setEnvelope(c, att);
            musLeft[c]--;
        }
    }
    if (noiseLeft) {
        u8 k = noiseFrames - noiseLeft;
        u8 att = noiseVol + (k * (15 - noiseVol)) / noiseFrames;
        PSG_setEnvelope(3, att > 15 ? 15 : att);
        if (--noiseLeft == 0) PSG_setEnvelope(3, PSG_ENVELOPE_MIN);
    }
}
