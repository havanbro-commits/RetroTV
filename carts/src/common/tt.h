// Tube TV — общий код картриджей: текст с кириллицей, звук PSG, случайные числа.
#pragma once
#include <genesis.h>

#define TT_FONT_BASE   TILE_USER_INDEX          // шрифт — первые тайлы пользователя
#define TT_FREE_BASE   (TILE_USER_INDEX + 100)  // дальше — графика игры

void tt_init(const u32 *font, u16 fontTiles);
void tt_text(VDPPlane plane, const char *s, u16 x, u16 y, u16 pal, u16 prio);
void tt_textc(VDPPlane plane, const char *s, u16 y, u16 pal, u16 prio);   // по центру экрана (40 тайлов)
u16  tt_len(const char *s);
void tt_num(VDPPlane plane, u32 v, u16 digits, u16 x, u16 y, u16 pal, u16 prio);
void tt_clear_row(VDPPlane plane, u16 y);
u16  tt_rand(u16 n);

// звук: короткие эффекты на каналах PSG 0..2 и шуме; музыка — на каналах 0 и 1
void tt_sfx(u8 ch, u16 f0, u16 f1, u8 frames, u8 vol);      // тон с глиссандо f0 → f1
void tt_noise(u8 frames, u8 vol, u8 type, u8 rate);        // шум: удар, взрыв
void tt_sound_update(void);                                // раз в кадр
typedef struct { u16 f; u8 len; } TTNote;                  // f = 0 — пауза
void tt_music(const TTNote *mel, const TTNote *bass, bool loop);
void tt_music_stop(void);
// ноты (Гц)
enum { N_C3 = 131, N_D3 = 147, N_E3 = 165, N_F3 = 175, N_G3 = 196, N_A3 = 220, N_B3 = 247,
       N_C4 = 262, N_D4 = 294, N_E4 = 330, N_F4 = 349, N_G4 = 392, N_A4 = 440, N_B4 = 494,
       N_C5 = 523, N_D5 = 587, N_E5 = 659, N_F5 = 698, N_G5 = 784, N_A5 = 880, N_B5 = 988, N_C6 = 1047 };
