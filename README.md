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
- `src/models.js`：動物模型與行為，以及樹枝、樹幹、石頭等停棲處。模型是沿脊線「放樣」出的平滑身體（`loft`），羽色花紋畫在頂點色上；腳用兩節 IK 踩地。鳥的脖子是每格重新排的管子（`flexNeck`），沿身體到頭的曲線彎成 S 形或伸直；頭的位置和朝向獨立決定，所以身體晃動時頭能保持穩定。鳥會眨眼。行為：地上的鳥會走動、覓食（`Walker` + `Acts` 動作表），枝上的鳥沿枝條跳（`Hopper`），松鼠在枝上跑、坐著啃東西，攀蜥在樹幹上爬、做伏地挺身，烏龜一隻曬太陽、一隻在水裡游。動物不烘進地面，地上的鳥自帶即時陰影。十種動物全部改用寫實模型（`models/*.glb`）：停枝的鳥共用 `perchTripo()`（程式做的 IK 腳 + 蹲低、蹬起、空中收腳、落地緩衝的跳躍），地上的鳥共用 `groundTripo()`（走路、盯地面、啄）。松鼠原檔沒有骨架，用 `tools/rig-squirrel.py` 在 Blender 綁了 25 根骨頭（脊椎、頭、手腳、尾巴 8 節，自動權重），程式直接轉骨頭做啃東西、張望、甩尾；毛色在著色器裡從美洲灰松鼠改成赤腹松鼠。攀蜥也是現成模型加骨架；程式用 `rigged()` 依「模型座標的軸」轉骨頭，左右腳才對稱。烏龜也綁了骨架（`tools/rig-turtle.py`：殼是硬的根骨頭、脖子兩節 + 頭、四腳各兩節、尾巴；掃描網格不封閉，權重依距離自己算），伸縮脖子、轉頭、縮進殼、划水都是轉骨頭。
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
  - 斯文豪氏攀蜥：用同屬的 [Sakishima Tree Lizard](https://sketchfab.com/3d-models/15f772d7febd45a48d3cecf1cef6fe10) by ffish.asia / floraZia.com，CC0
  - 五色鳥：參考圖以 ChatGPT 生成（側面、頭朝左、腳露出來、白底），再以 [Tripo AI](https://www.tripo3d.ai/) 轉成 3D。腳用模型自己生成的，`tools/shrink-model.py` 減到 4 萬面後用 `tools/rig-distance.py ... barbet2` 綁骨架（含 thigh → shin → foot），點位在 `tools/bird-points.json`
  - 黑冠麻鷺、夜鷺、白頭翁、綠繡眼、珠頸斑鳩、樹鵲：在同一個 ChatGPT 對話裡生成參考圖（下面的規格），再用 Tripo AI 轉成 3D。原圖在 `models/raw/ref/`（不進 git）
    - 參考圖規格（第一張完整寫、後面說「同樣規格」再換物種）：寫實照片風格、羽色照真實物種；全身正側面、頭朝左、平視不透視；翅膀收好；兩隻腳完整露出、分開站在平面上，**不要樹枝**；地上走的鳥要「兩腳並排站直、前後位置相同，不要一前一後走路的姿勢」（斑鳩第一版是走路姿勢，綁出來一隻腳被拉長，重做）；純白背景、無陰影、無文字；只畫一隻、置中、約佔畫面 70%；並說明「這是要給 3D 生成工具 Tripo 轉成 3D 模型、之後在 Blender 綁骨架做動作用」
    - 這樣 Tripo 出來的模型都是頭朝 -x、左右對稱，點位好量。停枝的鳥用 `tools/cut-below.py` 切掉腳（改用程式的 IK 腳），地上走的鳥保留腳、綁 thigh → shin → foot；腳趾由 `rig-distance.py` 自動找（腳踝以下的頂點依方向分 4 群，每根兩節，`bird-points.json` 的 `toes` 給起始方向）；走路照影片：抬腳時腳跟往前上提、跗蹠往後折、腳趾收起，落地前伸直張開。黑冠麻鷺另外把身體分兩節（body → chest）、脖子分三節（neck → neck2 → neck3），頭部用 `headRigid` 整顆綁給 head（伸脖子時頭和冠羽不變形）；綁骨架都用 `tools/rig-distance.py`（點位和切腳高度存在 `tools/bird-points.json`；白頭翁的點位寫在 rig-distance.py 裡）
  - 攀蜥用 `tools/shrink-model.py` 減到 3 萬面，再用 `tools/rig-distance.py` 綁骨架（權重依距離算；捲起來的尾巴在程式裡拉直）

- 地圖資料 © OpenStreetMap contributors（ODbL），網頁結尾已標示來源。
- 衛星空拍圖有版權，只能拿來對照，不放進網站。
- 動物地點是依照地圖上草地、樹林、池塘挑的大概位置，還需要熟悉輔大的人確認。

## 部署

push 到 main 約一分鐘上線。GitHub Pages 會把 JS 和模型檔快取 10 分鐘，所以 push 前先跑 `tools/bump-version.sh` 換掉 `index.html` 裡的 `?v=` 版本號（JS 經 importmap、模型經 `VER` 都會跟著換），訪客重新整理就會拿到新版。
