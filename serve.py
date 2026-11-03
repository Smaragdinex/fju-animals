# 本機預覽用：跟 python -m http.server 一樣，但不讓瀏覽器快取（改完 JS 重新整理就生效）
import http.server, sys, os

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

os.chdir(os.path.dirname(os.path.abspath(__file__)))
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8794
http.server.ThreadingHTTPServer(('', port), NoCache).serve_forever()
