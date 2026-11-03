#!/bin/sh
# 部署前換版本號（index.html 裡所有 ?v=），讓瀏覽器不用等 GitHub Pages 的 10 分鐘快取
cd "$(dirname "$0")/.." && perl -pi -e 's/\?v=\d+/?v='"$(date +%s)"'/g' index.html && grep -o '?v=[0-9]*' index.html | head -1
