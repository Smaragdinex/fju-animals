# 輔大的動物鄰居

用 3D 輔仁大學校園模型介紹校園裡的 10 種動物。往下捲動，鏡頭會依序飛到每種動物大概出沒的地點，旁邊顯示簡介卡。

## 執行

```bash
python3 fju-animals/serve.py 8794
```

打開 http://localhost:8794/ 。serve.py 會關掉快取，改完 JS 重新整理就會生效。

## 線上版

https://smaragdinex.github.io/fju-animals/ （GitHub Pages，repo `Smaragdinex/fju-animals`）。push 到 main 約 1 分鐘後更新；手機上看要加 `?cb=任意數字` 繞過快取。

## 結構

- `campus.json`：校園地圖，由 `data/convert.py` 從 `data/area.json`（OpenStreetMap 原始資料）轉成公尺座標。原點在校園中心，x 向東、z 向南。
- `src/ground.js`：地面。草地、樹林、球場、道路、池塘全部畫進一張貼圖（不再一層層疊平面，所以不會閃爍）；載入時把陽光陰影和天光遮蔽**烘焙**進另一張貼圖，地面之後不再即時算陰影。桌機 4096、手機 2048。
- `src/campus.js`：建築（含女兒牆、屋頂機房、牆腳壓暗）、高模樹、荷花池水面。
- `src/animals.js`：10 種動物的文字介紹、地點（`spot`）、停棲方式和鏡頭方位。**改地點或文案都在這裡。**
- `src/models.js`：動物模型與行為，以及樹枝、樹幹、石頭等停棲處。模型是沿脊線「放樣」出的平滑身體（`loft`），羽色花紋畫在頂點色上；腳用兩節 IK 踩地。鳥的脖子是每格重新排的管子（`flexNeck`），沿身體到頭的曲線彎成 S 形或伸直；頭的位置和朝向獨立決定，所以身體晃動時頭能保持穩定。鳥會眨眼。行為：地上的鳥會走動、覓食（`Walker` + `Acts` 動作表），枝上的鳥沿枝條跳（`Hopper`），松鼠在枝上跑、坐著啃東西，攀蜥在樹幹上爬、做伏地挺身，烏龜一隻曬太陽、一隻在水裡游。動物不烘進地面，地上的鳥自帶即時陰影。松鼠和烏龜改用現成的寫實模型（`models/*.glb`），松鼠原檔沒有骨架，用 `tools/rig-squirrel.py` 在 Blender 綁了 25 根骨頭（脊椎、頭、手腳、尾巴 8 節，自動權重），程式直接轉骨頭做啃東西、張望、甩尾；毛色在著色器裡從美洲灰松鼠改成赤腹松鼠。烏龜也綁了骨架（`tools/rig-turtle.py`：殼是硬的根骨頭、脖子兩節 + 頭、四腳各兩節、尾巴；掃描網格不封閉，權重依距離自己算），伸縮脖子、轉頭、縮進殼、划水都是轉骨頭。
- `src/foliage.js`：植物細節。全校樹冠有一簇簇明暗、樹幹有樹皮紋；動物地點附近才長真的草葉和樹冠葉片，而且一次只畫鏡頭所在的那一處，所以全校的面數幾乎不變。草葉的顏色取自地面貼圖、光影取自烘好的地面，遠處會融進地面。
- `src/main.js`：捲動與鏡頭的對應、燈光（西南斜陽 + 近景補光）、地點標籤（會互相避開）、右側導覽點。除錯可設 `__fju.view = { pos: [x,y,z], target: [x,y,z] }` 固定鏡頭。`__fju.pause = true` 讓動物停住。

## 要重新抓地圖

```bash
curl -A "fju-animals" https://maps.mail.ru/osm/tools/overpass/api/interpreter \
  --data-urlencode 'data=[out:json][timeout:90];(way(25.0320,121.4280,25.0412,121.4368);relation(id:10830273););out geom;' \
  -o fju-animals/data/area.json
python3 fju-animals/data/convert.py
```

## 授權與注意

- 現成模型（原檔在 `models/raw/`，不進 git；烏龜用 `tools/shrink-model.py` 減面到 4 萬面、Draco 壓縮；松鼠用 `tools/rig-squirrel.py` 綁骨架，都放在 `models/`）：
  - 松鼠：[Eastern gray squirrel](https://sketchfab.com/3d-models/111eaa6a9868485bb2ae71a9b409fbb8) by faerbogdan99，CC BY 4.0（要標作者，網頁結尾已標示；已改毛色）
  - 曬太陽的烏龜：[Reeve's Pond Turtle](https://sketchfab.com/3d-models/638f29eae79d40ddb0adaf6ebb8375cc)（斑龜的近親）by ffish.asia / floraZia.com，CC0
  - 游泳的烏龜：[Red-eared Slider](https://sketchfab.com/3d-models/ce4dd87f62564d7bb3804023044b2b62) by ffish.asia / floraZia.com，CC0

- 地圖資料 © OpenStreetMap contributors（ODbL），網頁結尾已標示來源。
- 衛星空拍圖有版權，只能拿來對照，不放進網站。
- 動物地點是依照地圖上草地、樹林、池塘挑的大概位置，還需要熟悉輔大的人確認。
