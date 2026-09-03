#!/bin/bash
cd "$(dirname "$0")"
echo "معاينة سهل على http://localhost:8899"
( sleep 1 && open "http://localhost:8899/index.html" ) &
python3 _preview/spa-server.py 8899 .
