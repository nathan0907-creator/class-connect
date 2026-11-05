# Demo videos of the candidate themes (the class votes for its favourite in the app).
#   python design/theme_videos.py   →   public/media/themes/<id>.mp4 (+ .jpg poster)
# Each video: the theme's animated background, with a mock of the app (sidebar + chat bubbles) in its colours.
import math
import os
import random
import subprocess

import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS, SECONDS = 960, 540, 30, 8
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'media', 'themes')
FONTS = os.path.join(os.environ.get('WINDIR', r'C:\Windows'), 'Fonts')
def font(name, size):
    try: return ImageFont.truetype(os.path.join(FONTS, name), size)
    except OSError: return ImageFont.load_default()

THEMES = {
    'galaxie': dict(name='Galaxie (actuel)', bg=((6, 4, 26), (40, 18, 90)), accent=(124, 92, 255), accent2=(0, 212, 255), text=(236, 235, 255), panel=(18, 13, 48), font='segoeuib.ttf'),
    'abysses': dict(name='Abysses', bg=((0, 12, 30), (0, 60, 90)), accent=(0, 190, 200), accent2=(120, 255, 220), text=(220, 250, 255), panel=(4, 30, 52), font='segoeuib.ttf'),
    'sakura': dict(name='Sakura', bg=((45, 20, 60), (240, 130, 150)), accent=(255, 120, 170), accent2=(255, 200, 120), text=(255, 245, 250), panel=(70, 30, 70), font='georgiab.ttf'),
    'neon': dict(name='Néon City', bg=((8, 0, 20), (40, 0, 60)), accent=(255, 40, 160), accent2=(0, 240, 255), text=(240, 240, 255), panel=(20, 6, 36), font='consolab.ttf'),
    'arcade': dict(name='Rétro Arcade', bg=((20, 16, 60), (60, 30, 110)), accent=(255, 214, 0), accent2=(80, 255, 120), text=(255, 255, 255), panel=(30, 24, 80), font='consolab.ttf'),
}


def gradient(top, bottom):
    t = np.linspace(0, 1, H)[:, None, None]
    g = np.array(top)[None, None, :] * (1 - t) + np.array(bottom)[None, None, :] * t
    return np.repeat(g, W, axis=1).astype(np.float32)


class Scene:
    """Animated background of each theme."""
    def __init__(self, tid):
        self.tid, self.t = tid, THEMES[tid]
        rnd = random.Random(tid)
        self.base = gradient(*self.t['bg'])
        self.stars = [(rnd.uniform(0, W), rnd.uniform(0, H), rnd.uniform(0.5, 2), rnd.random()) for _ in range(160)]
        self.items = [dict(x=rnd.uniform(0, W), y=rnd.uniform(0, H), s=rnd.uniform(0.6, 1.4), p=rnd.random()) for _ in range(40)]

    def draw(self, t):
        img = Image.fromarray(self.base.astype(np.uint8))
        d = ImageDraw.Draw(img, 'RGBA')
        k = self.tid
        if k == 'galaxie':
            for x, y, r, p in self.stars:
                a = int(150 + 100 * math.sin(t * 2 + p * 6))
                d.ellipse((x - r, y - r, x + r, y + r), fill=(255, 255, 255, a))
            cx, cy = W * 0.78 + math.sin(t * .3) * 10, H * 0.72
            d.ellipse((cx - 120, cy - 120, cx + 120, cy + 120), fill=(108, 76, 255, 255))
            d.ellipse((cx - 200, cy - 40, cx + 200, cy + 40), outline=(0, 212, 255, 200), width=6)
        elif k == 'abysses':
            for i, it in enumerate(self.items[:25]):   # bubbles rising
                y = (it['y'] - t * 60 * it['s']) % (H + 40)
                x = it['x'] + math.sin(t * 2 + i) * 8
                r = 3 + it['s'] * 5
                d.ellipse((x - r, y - r, x + r, y + r), outline=(180, 255, 255, 160), width=2)
            for i, it in enumerate(self.items[25:31]):   # glowing jellyfish
                x = it['x']
                y = (it['y'] - t * 18) % (H + 120) - 60
                pulse = 1 + math.sin(t * 3 + i) * 0.15
                r = 26 * it['s'] * pulse
                d.pieslice((x - r, y - r, x + r, y + r), 180, 360, fill=(120, 255, 230, 110))
                for j in range(5):
                    xx = x - r * 0.7 + j * r * 0.35
                    d.line([(xx, y), (xx + math.sin(t * 3 + j) * 6, y + r * 1.8)], fill=(120, 255, 230, 90), width=2)
            for j in range(6):   # light rays
                x0 = 120 + j * 160 + math.sin(t * .5 + j) * 30
                d.polygon([(x0, 0), (x0 + 60, 0), (x0 - 80, H), (x0 - 160, H)], fill=(160, 240, 255, 14))
        elif k == 'sakura':
            sx, sy = W * 0.5, H * 0.95
            d.ellipse((sx - 140, sy - 140, sx + 140, sy + 140), fill=(255, 200, 150, 180))   # setting sun
            d.polygon([(0, H), (220, H * 0.62), (430, H)], fill=(60, 25, 70, 255))            # mountains
            d.polygon([(330, H), (640, H * 0.55), (960, H)], fill=(80, 35, 85, 255))
            for i, it in enumerate(self.items):   # falling petals
                y = (it['y'] + t * 40 * it['s']) % (H + 20)
                x = (it['x'] + math.sin(t * 1.5 + i) * 30 + t * 15) % W
                a = t * 2 + i
                pts = [(x + math.cos(a + q) * 7 * it['s'], y + math.sin(a + q) * 4 * it['s']) for q in (0, 1.6, 3.1, 4.7)]
                d.polygon(pts, fill=(255, 170, 200, 220))
        elif k == 'neon':
            for i in range(14):   # skyline
                bw = 50 + (i * 37) % 40
                bh = 120 + (i * 53) % 200
                x = i * 72 - 20
                d.rectangle((x, H - bh, x + bw, H), fill=(14, 4, 30, 255), outline=(255, 40, 160, 120) if i % 2 else (0, 240, 255, 120))
                for wy in range(H - bh + 10, H - 10, 18):
                    if (wy + i) % 3 == 0:
                        d.rectangle((x + 8, wy, x + 16, wy + 6), fill=(255, 220, 120, 160 if (int(t * 2) + wy) % 5 else 40))
            for it in self.items:   # rain
                y = (it['y'] + t * 500 * it['s']) % H
                d.line([(it['x'], y), (it['x'] - 4, y + 18)], fill=(150, 200, 255, 110), width=1)
            hy = H * 0.55   # neon grid on the floor
            for j in range(10):
                yy = hy + (j ** 1.6) * 6 + (t * 20) % 12
                d.line([(0, yy), (W, yy)], fill=(255, 40, 160, 60), width=1)
        elif k == 'arcade':
            px = 8
            small = Image.new('RGB', (W // px, H // px))
            sd = ImageDraw.Draw(small)
            sd.rectangle((0, 0, W // px, H // px), fill=self.t['bg'][0])
            for x, y, r, p in self.stars:
                if int(t * 4 + p * 10) % 3: sd.point((x / px, y / px), fill=(255, 255, 255))
            gx = (t * 12) % (W // px)
            for i, col in enumerate([(255, 80, 80), (255, 214, 0), (80, 255, 120), (80, 160, 255)]):   # pixel ghosts / invaders
                bx = (gx + i * 30) % (W // px)
                by = 18 + math.sin(t * 2 + i) * 4
                sd.rectangle((bx, by, bx + 6, by + 5), fill=col)
                sd.point((bx + 2, by + 2), fill=(0, 0, 0)); sd.point((bx + 4, by + 2), fill=(0, 0, 0))
            sd.rectangle((0, H // px - 6, W // px, H // px), fill=(80, 255, 120))
            img = small.resize((W, H), Image.NEAREST).convert('RGB')
            d = ImageDraw.Draw(img, 'RGBA')
        return img


def ui(img, tid, t):
    """Mock of the app: sidebar + chat bubbles appearing one by one."""
    th = THEMES[tid]
    d = ImageDraw.Draw(img, 'RGBA')
    f_title = font(th['font'], 22)
    f = font('segoeui.ttf' if tid not in ('neon', 'arcade') else 'consola.ttf', 16)
    radius = 0 if tid == 'arcade' else 18
    d.rounded_rectangle((24, 24, 214, H - 24), radius, fill=th['panel'] + (210,), outline=th['accent'] + (160,), width=2)
    d.text((44, 44), 'CLASS CONNECT', font=f_title, fill=th['accent2'])
    for i, label in enumerate(['Chat', 'Emploi du temps', 'Vie de classe', 'Révisions']):
        y = 100 + i * 46
        if i == 0: d.rounded_rectangle((36, y - 8, 202, y + 28), radius // 2, fill=th['accent'] + (120,))
        d.text((50, y), label, font=f, fill=th['text'])
    msgs = [('Léa', 'Quelqu\'un a fait l\'exo 4 ?', False), ('Toi', 'Oui ! je t\'envoie ma méthode', True),
            ('Tom', 'Le contrôle est décalé à jeudi !', False), ('Toi', 'Trop bien :)', True)]
    for i, (who, text, mine) in enumerate(msgs):
        appear = 0.8 + i * 1.3
        if t < appear: continue
        k = min(1, (t - appear) / 0.35)
        y = 70 + i * 92 + (1 - k) * 20
        tw = d.textlength(text, font=f) + 36
        x = W - 40 - tw if mine else 250
        col = th['accent'] if mine else th['panel']
        d.rounded_rectangle((x, y, x + tw, y + 52), radius, fill=col + (int(235 * k),), outline=th['accent2'] + (int(90 * k),), width=1)
        d.text((x + 18, y + 6), who, font=font('segoeuib.ttf', 13), fill=th['accent2'] if not mine else th['text'])
        d.text((x + 18, y + 25), text, font=f, fill=th['text'])
    banner = th['name']
    bw = d.textlength(banner, font=font(th['font'], 30)) + 40
    d.rounded_rectangle((W - bw - 30, H - 74, W - 30, H - 26), radius, fill=(0, 0, 0, 150))
    d.text((W - bw - 10, H - 70), banner, font=font(th['font'], 30), fill=th['accent2'])
    return img


def render(tid):
    os.makedirs(OUT, exist_ok=True)
    scene = Scene(tid)
    out = os.path.join(OUT, f'{tid}.mp4')
    p = subprocess.Popen([imageio_ffmpeg.get_ffmpeg_exe(), '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
                          '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '30',
                          '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out], stdin=subprocess.PIPE)
    for k in range(SECONDS * FPS):
        t = k / FPS
        frame = ui(scene.draw(t), tid, t)
        p.stdin.write(frame.tobytes())
        if k == FPS * 6:
            frame.save(os.path.join(OUT, f'{tid}.jpg'), quality=78, optimize=True, progressive=True)
    p.stdin.close(); p.wait()
    print(f'✔ {tid} : {os.path.getsize(out) // 1024} Ko')


if __name__ == '__main__':
    for tid in THEMES:
        render(tid)
