#!/bin/sh
# 部署前換版本號（index.html 裡所有 ?v=），讓瀏覽器不用等 GitHub Pages 的 10 分鐘快取。
# 模型另外用 MODEL_VER（models.js）：依模型檔內容算，模型沒改就不變，訪客的手機可以沿用快取、不用重下載。
cd "$(dirname "$0")/.." || exit 1
perl -pi -e 's/\?v=\d+/?v='"$(date +%s)"'/g' index.html
M=$(cat models/*.glb | shasum | cut -c1-8)
perl -pi -e "s/^const MODEL_VER = '[^']*'/const MODEL_VER = '$M'/" src/models.js
grep -o '?v=[0-9]*' index.html | head -1
grep -o "MODEL_VER = '[^']*'" src/models.js
