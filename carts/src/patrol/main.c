// «ЗВЁЗДНЫЙ ПАТРУЛЬ» — картридж Tube TV: вертикальная стрелялка. Волны тарелок, жуков и бомбардировщиков.
#include <genesis.h>
#include "tt.h"
#include "gfx.h"

#define TS (TT_FREE_BASE)                 // спрайты
#define TK (TS + SPR_TILES)               // небо
#define TT1 (TK + SKY_TILES)
#define TT2 (TT1 + TITLE1_W * TITLE1_H)

#define MAXB 8
#define MAXE 10
#define MAXEB 10
#define MAXX 8

typedef struct { s16 x, y, vx, vy; u8 on; } Bul;
typedef struct { s32 x, y; s16 vx, vy; u8 on, type, hp, t; s16 ph, cx; u16 age; } Ene;
typedef struct { s16 x, y; u8 on, t; } Boom;

static s16 px, py; static u8 lives, inv, cool, dbl;
static u16 dblTimer;
static Bul bl[MAXB], eb[MAXEB];
static Ene en[MAXE];
static Boom bx[MAXX];
static s16 starX, starY; static u8 starOn;
static u32 score, best;
static u16 wave, spawnLeft, spawnT, frame;
static u8 waveType;
static s16 colScroll[20];                  // звёздное небо листается столбцами с разной скоростью — параллакс
static const u8 colSpeed[20] = { 3, 1, 2, 4, 1, 3, 2, 1, 4, 2, 1, 3, 2, 4, 1, 2, 3, 1, 4, 2 };
static void scroll_sky(void)
{
    for (u8 i = 0; i < 20; i++) colScroll[i] -= colSpeed[i];
    static s16 v[20];
    for (u8 i = 0; i < 20; i++) v[i] = colScroll[i] >> 2;
    VDP_setVerticalScrollTile(BG_B, 0, v, 20, DMA_QUEUE);
}
static u16 prevJoy;
static bool over;

static const s16 sinT[64] = { 0, 25, 50, 74, 98, 121, 142, 162, 181, 198, 213, 226, 237, 245, 251, 255, 256, 255, 251, 245, 237, 226, 213, 198, 181, 162, 142, 121, 98, 74, 50, 25,
    0, -25, -50, -74, -98, -121, -142, -162, -181, -198, -213, -226, -237, -245, -251, -255, -256, -255, -251, -245, -237, -226, -213, -198, -181, -162, -142, -121, -98, -74, -50, -25 };

static const TTNote m_title[] = {
    {N_A4, 12}, {N_E5, 12}, {N_D5, 6}, {N_C5, 6}, {N_B4, 12}, {N_C5, 12}, {N_A4, 24},
    {N_G4, 12}, {N_D5, 12}, {N_C5, 6}, {N_B4, 6}, {N_A4, 12}, {N_B4, 12}, {N_E4, 24},
    {N_A4, 12}, {N_E5, 12}, {N_F5, 6}, {N_E5, 6}, {N_D5, 12}, {N_C5, 12}, {N_B4, 12}, {N_C5, 12},
    {N_D5, 12}, {N_B4, 12}, {N_A4, 36}, {0, 12}, {0, 0} };
static const TTNote b_title[] = {
    {N_A3, 24}, {N_A3, 24}, {N_F3, 24}, {N_F3, 24}, {N_G3, 24}, {N_G3, 24}, {N_E3, 24}, {N_E3, 24},
    {N_A3, 24}, {N_A3, 24}, {N_D3, 24}, {N_D3, 24}, {N_E3, 24}, {N_E3, 24}, {N_A3, 48}, {0, 0} };

static void hud(void)
{
    tt_text(WINDOW, "ОЧКИ", 1, 0, PAL0, 1); tt_num(WINDOW, score, 6, 6, 0, PAL3, 1);
    tt_text(WINDOW, "ВОЛНА", 15, 0, PAL0, 1); tt_num(WINDOW, wave, 2, 21, 0, PAL3, 1);
    tt_text(WINDOW, "КОРАБЛИ", 26, 0, PAL0, 1); tt_num(WINDOW, lives, 1, 34, 0, PAL3, 1);
    tt_text(WINDOW, "РЕКОРД", 14, 1, PAL0, 1); tt_num(WINDOW, best, 6, 21, 1, PAL3, 1);
}

static void sky(void)
{
    // плоскость B — дальние звёзды, A — ближние (крупнее и реже), обе листаются с разной скоростью
    for (u16 y = 0; y < 32; y++) for (u16 x = 0; x < 64; x++) {
        u16 r = tt_rand(100);
        u16 t = r < 72 ? 0 : 1 + (r % 7);
        VDP_setTileMapXY(BG_B, TILE_ATTR_FULL(PAL1, 0, 0, 0, TK + t), x, y);
        if (tt_rand(100) < 2) VDP_setTileMapXY(BG_B, TILE_ATTR_FULL(PAL1, 0, 0, 0, TK + 8), x, y);   // редкие крупные звёзды
    }
}

static void boom(s16 x, s16 y, bool big)
{
    for (u8 i = 0; i < MAXX; i++) if (!bx[i].on) { bx[i].on = 1; bx[i].x = x; bx[i].y = y; bx[i].t = 0; break; }
    tt_noise(big ? 40 : 18, big ? 0 : 3, PSG_NOISE_TYPE_WHITE, big ? PSG_NOISE_FREQ_CLOCK8 : PSG_NOISE_FREQ_CLOCK4);
}

static void spawn(void)
{
    for (u8 i = 0; i < MAXE; i++) if (!en[i].on) {
        Ene *e = &en[i];
        e->on = 1; e->type = waveType; e->age = 0; e->t = tt_rand(60);
        e->hp = waveType == 2 ? 3 : 1;
        if (waveType == 0) {                     // тарелки: змейкой сверху
            e->cx = 40 + ((wave * 37 + spawnLeft * 0) % 200); e->x = e->cx << 4; e->y = -16 << 4;
            e->vy = 16 + wave * 2; e->vx = 0; e->ph = spawnLeft * 6;
        } else if (waveType == 1) {             // жуки: пикируют с боков
            bool l = spawnLeft & 1;
            e->x = (l ? -16 : 320) << 4; e->y = (30 + tt_rand(40)) << 4;
            e->vx = l ? 28 : -28; e->vy = 6; e->ph = 0;
        } else {                                 // бомбардировщики: медленно поперёк, сыплют снаряды
            e->x = (tt_rand(2) ? -16 : 320) << 4; e->y = (40 + tt_rand(50)) << 4;
            e->vx = (e->x < 0) ? 10 + wave : -10 - wave; e->vy = 2; e->ph = 0;
        }
        return;
    }
}

static void next_wave(void)
{
    wave++;
    waveType = (wave - 1) % 3;
    spawnLeft = 6 + (wave > 9 ? 9 : wave);
    spawnT = 60;
    hud();
    tt_textc(BG_A, " ВОЛНА    ", 11, PAL3, 1);
    tt_num(BG_A, wave, 2, 23, 11, PAL3, 1);
}

static void fire_enemy(Ene *e)
{
    for (u8 i = 0; i < MAXEB; i++) if (!eb[i].on) {
        Bul *b = &eb[i]; b->on = 1;
        b->x = (e->x >> 4) + 4; b->y = (e->y >> 4) + 10;
        s16 dx = px + 4 - b->x, dy = py - b->y;
        s16 ax = dx < 0 ? -dx : dx, ay = dy < 0 ? -dy : dy, m = ax > ay ? ax + ay / 2 : ay + ax / 2;
        if (m < 1) m = 1;
        s16 sp = 22 + wave * 2;
        if (sp > 48) sp = 48;
        b->vx = dx * sp / m; b->vy = dy * sp / m;
        if (b->vy < 8) b->vy = 8;
        b->x <<= 4; b->y <<= 4;
        tt_sfx(2, 900, 600, 5, 6);
        return;
    }
}

static void player_hit(void)
{
    if (inv) return;
    boom(px, py, TRUE);
    tt_sfx(0, N_C5, N_C3, 40, 1);
    if (lives) lives--;
    inv = 120; dbl = 0;
    hud();
    if (!lives) {
        over = TRUE;
        if (score > best) best = score;
        hud();
        tt_clear_row(BG_A, 11);
        tt_textc(BG_A, " ИГРА ОКОНЧЕНА ", 13, PAL3, 1);
        tt_textc(BG_A, " НАЖМИТЕ START ", 15, PAL0, 1);
    }
}

static void new_game(void)
{
    memset(bl, 0, sizeof(bl)); memset(eb, 0, sizeof(eb)); memset(en, 0, sizeof(en)); memset(bx, 0, sizeof(bx));
    px = 152; py = 180; lives = 3; inv = 90; cool = 0; dbl = 0; starOn = 0;
    score = 0; wave = 0; over = FALSE;
    tt_music_stop();
    sky();
    next_wave();
}

static u16 nspr;
static void put(s16 x, s16 y, u8 size, u16 attr)
{
    if (nspr >= 79 || y < -32 || y > 240 || x < -32 || x > 330) return;
    VDP_setSpriteFull(nspr, x, y, size, attr, nspr + 1);
    nspr++;
}

static void draw(void)
{
    nspr = 0;
    if (!over && (!inv || (frame & 4))) {
        put(px, py, SPRITE_SIZE(2, 2), TILE_ATTR_FULL(PAL2, 1, 0, 0, TS + S_SHIP));
        put(px + 4, py + 14, SPRITE_SIZE(1, 1), TILE_ATTR_FULL(PAL2, 1, 0, 0, TS + ((frame & 2) ? S_FLAME1 : S_FLAME2)));
    }
    for (u8 i = 0; i < MAXB; i++) if (bl[i].on) put(bl[i].x, bl[i].y, SPRITE_SIZE(1, 1), TILE_ATTR_FULL(PAL2, 1, 0, 0, TS + S_SHOT));
    for (u8 i = 0; i < MAXEB; i++) if (eb[i].on) put(eb[i].x >> 4, eb[i].y >> 4, SPRITE_SIZE(1, 1), TILE_ATTR_FULL(PAL2, 1, 0, 0, TS + S_ESHOT));
    for (u8 i = 0; i < MAXE; i++) if (en[i].on) {
        Ene *e = &en[i];
        u16 t = e->type == 0 ? ((frame >> 3) & 1 ? S_SAUCER2 : S_SAUCER) : e->type == 1 ? S_BUG : S_BOMBER;
        bool flip = e->type == 1 && e->vx < 0;
        put(e->x >> 4, e->y >> 4, SPRITE_SIZE(2, 2), TILE_ATTR_FULL(PAL2, 1, 0, flip, TS + t));
    }
    for (u8 i = 0; i < MAXX; i++) if (bx[i].on) put(bx[i].x, bx[i].y, SPRITE_SIZE(2, 2), TILE_ATTR_FULL(PAL2, 1, 0, 0, TS + S_BOOM0 + (bx[i].t / 5) * 4));
    if (starOn) put(starX, starY, SPRITE_SIZE(1, 1), TILE_ATTR_FULL(PAL2, 1, 0, 0, TS + S_STAR));
    if (nspr == 0) { VDP_setSpriteFull(0, -32, -32, SPRITE_SIZE(1, 1), 0, 0); nspr = 1; }
    else VDP_setSpriteLink(nspr - 1, 0);
    VDP_updateSprites(nspr, DMA_QUEUE);
}

static bool hit(s16 ax, s16 ay, s16 aw, s16 ah, s16 bx_, s16 by, s16 bw, s16 bh)
{
    return ax < bx_ + bw && ax + aw > bx_ && ay < by + bh && ay + ah > by;
}

static void update(u16 j, u16 pressed)
{
    // корабль
    if (!over) {
        s16 sp = 2;
        if (j & BUTTON_LEFT) px -= sp;
        if (j & BUTTON_RIGHT) px += sp;
        if (j & BUTTON_UP) py -= sp;
        if (j & BUTTON_DOWN) py += sp;
        px = px < 4 ? 4 : (px > 300 ? 300 : px);
        py = py < 24 ? 24 : (py > 204 ? 204 : py);
        if (cool) cool--;
        if ((j & (BUTTON_A | BUTTON_B | BUTTON_C)) && !cool) {
            cool = 9;
            for (u8 k = 0; k < (dbl ? 2 : 1); k++)
                for (u8 i = 0; i < MAXB; i++) if (!bl[i].on) { bl[i].on = 1; bl[i].x = px + 4 + (dbl ? (k ? 5 : -5) : 0); bl[i].y = py - 6; break; }
            tt_sfx(1, 1800, 1100, 4, 4);
        }
        if (inv) inv--;
        if (dbl && --dblTimer == 0) dbl = 0;
    }
    for (u8 i = 0; i < MAXB; i++) if (bl[i].on) { bl[i].y -= 6; if (bl[i].y < 8) bl[i].on = 0; }
    // враги
    if (!over && spawnLeft && --spawnT == 0) { spawn(); spawnLeft--; spawnT = waveType == 2 ? 70 : 24; if (spawnLeft == 0) tt_clear_row(BG_A, 11); }
    bool any = FALSE;
    for (u8 i = 0; i < MAXE; i++) if (en[i].on) {
        Ene *e = &en[i]; any = TRUE; e->age++;
        if (e->type == 0) { e->y += e->vy; e->x = (e->cx + ((sinT[(e->age + e->ph) & 63] * 60) >> 8)) << 4; }
        else if (e->type == 1) { e->x += e->vx; e->y += e->vy; if (e->age > 40) e->vy += 1; }
        else { e->x += e->vx; e->y += e->vy; }
        s16 x = e->x >> 4, y = e->y >> 4;
        if (y > 230 || x < -40 || x > 360) { e->on = 0; continue; }
        if (!over && y > 8 && y < 170 && ++e->t > (e->type == 2 ? 80 : 210 - (wave > 12 ? 120 : wave * 10))) { e->t = tt_rand(40); fire_enemy(e); }
        for (u8 b = 0; b < MAXB; b++) if (bl[b].on && hit(bl[b].x + 2, bl[b].y, 4, 8, x + 1, y + 1, 14, 12)) {
            bl[b].on = 0;
            if (--e->hp == 0) {
                e->on = 0; boom(x, y, FALSE);
                score += e->type == 2 ? 300 : e->type == 1 ? 150 : 100;
                if (!starOn && tt_rand(14) == 0) { starOn = 1; starX = x + 4; starY = y + 4; }
                hud();
            } else tt_sfx(2, 400, 300, 4, 3);
            break;
        }
        if (e->on && !over && hit(px + 3, py + 3, 10, 11, x + 2, y + 2, 12, 10)) { e->on = 0; boom(x, y, FALSE); player_hit(); }
    }
    for (u8 i = 0; i < MAXEB; i++) if (eb[i].on) {
        Bul *b = &eb[i]; b->x += b->vx; b->y += b->vy;
        s16 x = b->x >> 4, y = b->y >> 4;
        if (y > 230 || y < -8 || x < -8 || x > 328) { b->on = 0; continue; }
        if (!over && hit(px + 5, py + 4, 6, 9, x + 2, y + 2, 4, 4)) { b->on = 0; player_hit(); }
    }
    for (u8 i = 0; i < MAXX; i++) if (bx[i].on && ++bx[i].t >= 20) bx[i].on = 0;
    if (starOn) {
        starY += 1;
        if (starY > 230) starOn = 0;
        else if (!over && hit(px, py, 16, 16, starX, starY, 8, 8)) {
            starOn = 0; dbl = 1; dblTimer = 60 * 15; score += 50; hud();
            tt_sfx(0, N_C5, N_C6, 8, 1); tt_sfx(1, N_E5, N_E5 * 2, 12, 2);
        }
    }
    if (!over && !spawnLeft && !any) next_wave();
}

static void title(void)
{
    VDP_clearPlane(BG_A, TRUE);
    sky();
    VDP_fillTileMapRect(BG_A, 0, 0, 4, 40, 18);
    for (u16 y = 0; y < TITLE1_H; y++) for (u16 x = 0; x < TITLE1_W; x++)
        VDP_setTileMapXY(BG_A, TILE_ATTR_FULL(PAL0, 1, 0, 0, TT1 + y * TITLE1_W + x), (40 - TITLE1_W) / 2 + x, 5 + y);
    for (u16 y = 0; y < TITLE2_H; y++) for (u16 x = 0; x < TITLE2_W; x++)
        VDP_setTileMapXY(BG_A, TILE_ATTR_FULL(PAL0, 1, 0, 0, TT2 + y * TITLE2_W + x), (40 - TITLE2_W) / 2 + x, 9 + y);
    tt_textc(BG_A, "ЗАЩИТИ СВОЙ ДВОР ОТ ТАРЕЛОК!", 15, PAL0, 1);
    tt_textc(BG_A, "A, B, C - ОГОНЬ  * - ДВОЙНОЙ", 17, PAL0, 1);
    tt_textc(BG_A, "TUBE TV 1995", 25, PAL0, 1);
    tt_music(m_title, b_title, TRUE);
    u16 f = 0;
    while (1) {
        u16 j = JOY_readJoypad(JOY_1);
        if ((j & (BUTTON_START | BUTTON_A | BUTTON_B | BUTTON_C)) && !(prevJoy & (BUTTON_START | BUTTON_A | BUTTON_B | BUTTON_C))) { prevJoy = j; break; }
        prevJoy = j;
        if ((f % 40) == 0) tt_textc(BG_A, "НАЖМИТЕ START", 21, PAL3, 1);
        if ((f % 40) == 26) tt_clear_row(BG_A, 21);
        scroll_sky();
        f++;
        tt_sound_update(); SYS_doVBlankProcess();
    }
    setRandomSeed(f * 13 + 5);
    VDP_clearPlane(BG_A, TRUE);
}

int main(bool hard)
{
    tt_init(font_data, FONT_TILES);
    VDP_loadTileData(spr_data, TS, SPR_TILES, DMA);
    VDP_loadTileData(sky_data, TK, SKY_TILES, DMA);
    VDP_loadTileData(title1_data, TT1, TITLE1_W * TITLE1_H, DMA);
    VDP_loadTileData(title2_data, TT2, TITLE2_W * TITLE2_H, DMA);
    PAL_setPalette(PAL0, pal_text, DMA);
    PAL_setPalette(PAL1, pal_stars, DMA);
    PAL_setPalette(PAL2, pal_spr, DMA);
    PAL_setPalette(PAL3, pal_text_y, DMA);
    VDP_setBackgroundColor(16 + 1);
    VDP_setScrollingMode(HSCROLL_PLANE, VSCROLL_COLUMN);
    VDP_setWindowHPos(FALSE, 0);
    VDP_setWindowVPos(FALSE, 0);              // окно пока скрыто
    best = 0;
    title();
    VDP_setWindowVPos(FALSE, 2);              // сверху две строки — счёт
    VDP_clearPlane(WINDOW, TRUE);
    new_game();
    while (1) {
        u16 j = JOY_readJoypad(JOY_1), pressed = j & ~prevJoy;
        prevJoy = j;
        if (over) { if (pressed & BUTTON_START) { VDP_clearPlane(BG_A, TRUE); new_game(); } }
        update(j, pressed);
        scroll_sky();
        draw();
        frame++;
        tt_sound_update();
        SYS_doVBlankProcess();
    }
    return 0;
}
