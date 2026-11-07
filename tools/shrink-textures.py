#!/usr/bin/env python3
"""把 GLB 裡的貼圖縮小重新壓（用 macOS 內建的 sips，不用裝套件）。

動物在網頁上離鏡頭約 6 公尺，畫面上只有幾百像素，2048 的貼圖手機根本用不到，
卻讓 11 隻動物加起來要下載 28 MB（手機網路慢時要等很久才出現畫面）。
  底色貼圖 baseColor → 1024
  法線、粗糙度／金屬度、其他 → 512
原檔先備份到 models/raw/full-tex/（不進 git）。只改圖片，幾何、骨架、動畫都不動。

用法：python3 tools/shrink-textures.py models/*.glb
"""
import json, os, shutil, struct, subprocess, sys, tempfile

BASE, OTHER, QUALITY = 1024, 512, 82


def read_glb(path):
    b = open(path, 'rb').read()
    jl = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + jl])
    bin_start = 20 + jl + 8
    bl = struct.unpack('<I', b[20 + jl:24 + jl])[0]
    return j, b[bin_start:bin_start + bl]


def write_glb(path, j, binary):
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    binary += b'\0' * ((4 - len(binary) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(binary)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(binary), 0x004E4942)); f.write(binary)


def shrink(data, size, tmp):
    src, dst = os.path.join(tmp, 'in.jpg'), os.path.join(tmp, 'out.jpg')
    open(src, 'wb').write(data)
    subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', str(QUALITY), '-Z', str(size), src, '--out', dst],
                   check=True, capture_output=True)
    out = open(dst, 'rb').read()
    return out if len(out) < len(data) else data


def main(paths):
    for path in paths:
        j, binary = read_glb(path)
        if not j.get('images'):
            continue
        # 哪些圖是底色
        base = set()
        for m in j.get('materials', []):
            t = m.get('pbrMetallicRoughness', {}).get('baseColorTexture')
            if t is not None:
                base.add(j['textures'][t['index']]['source'])
        bak = os.path.join(os.path.dirname(path), 'raw', 'full-tex', os.path.basename(path))
        os.makedirs(os.path.dirname(bak), exist_ok=True)
        if not os.path.exists(bak):
            shutil.copy2(path, bak)
        img_views = {im['bufferView']: i for i, im in enumerate(j['images']) if 'bufferView' in im}
        new_bin, before = bytearray(), len(binary)
        with tempfile.TemporaryDirectory() as tmp:
            for vi, v in enumerate(j['bufferViews']):
                o = v.get('byteOffset', 0)
                data = binary[o:o + v['byteLength']]
                if vi in img_views and j['images'][img_views[vi]].get('mimeType') == 'image/jpeg':
                    data = shrink(data, BASE if img_views[vi] in base else OTHER, tmp)
                new_bin += b'\0' * ((4 - len(new_bin) % 4) % 4)
                v['byteOffset'] = len(new_bin)
                v['byteLength'] = len(data)
                new_bin += data
        j['buffers'][0]['byteLength'] = len(new_bin)
        write_glb(path, j, bytes(new_bin))
        print(f'{os.path.basename(path)}: {before // 1024} KB -> {len(new_bin) // 1024} KB')


if __name__ == '__main__':
    main(sys.argv[1:])
