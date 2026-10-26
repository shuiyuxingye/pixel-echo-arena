#!/usr/bin/env bash
# Deploy only this game's inline build to the existing authenticated showcase.
# Credentials are provided by the user's SSH agent/config; never copy them into the package.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOST="${DEPLOY_HOST:-huawei-cloud}"
PUBLIC_COMMIT="${PUBLIC_COMMIT:-$(git -C "$ROOT" rev-parse github-main)}"
RELEASE="$(TZ=Asia/Shanghai date +%Y%m%d-%H%M%S)-game-${PUBLIC_COMMIT:0:8}"
STAGE="$ROOT/.local/art/deploy-$RELEASE"
mkdir -p "$STAGE"
cp "$ROOT/output/share/game/像素回响.html" "$STAGE/index.html"
cp "$ROOT/output/share/game/THIRD_PARTY_NOTICES.txt" "$STAGE/THIRD_PARTY_NOTICES.txt"
python3 - "$STAGE/release.json" "$PUBLIC_COMMIT" "$RELEASE" <<'PY'
import json,sys
from pathlib import Path
Path(sys.argv[1]).write_text(json.dumps({'version':'0.3.0','edition':'星盘熔炉美术版','publicCommit':sys.argv[2],'release':sys.argv[3],'skippedChecks':['人工18波试玩','性能/泄漏压力检测']},ensure_ascii=False,indent=2)+'\n')
PY
ssh -o BatchMode=yes -o ConnectTimeout=12 "$HOST" "mkdir -p '/srv/shuiyu/incoming/$RELEASE'"
scp -q "$STAGE/index.html" "$STAGE/THIRD_PARTY_NOTICES.txt" "$STAGE/release.json" "$HOST:/srv/shuiyu/incoming/$RELEASE/"
ssh -o BatchMode=yes "$HOST" bash -s -- "$RELEASE" <<'REMOTE'
set -euo pipefail
release="$1"
current=/srv/shuiyu/current
old=$(readlink -f "$current")
case "$old" in /srv/shuiyu/releases/*) ;; *) echo 'Unexpected static root; stopped without modifying it.' >&2; exit 1;; esac
new="/srv/shuiyu/releases/$release"
incoming="/srv/shuiyu/incoming/$release"
test ! -e "$new"
mkdir "$new"
cp -a --reflink=auto "$old/." "$new/"
mkdir -p "$new/game"
chmod 755 "$new" "$new/game"
install -m 644 "$incoming/index.html" "$new/game/index.html"
install -m 644 "$incoming/THIRD_PARTY_NOTICES.txt" "$new/game/THIRD_PARTY_NOTICES.txt"
install -m 644 "$incoming/release.json" "$new/game/release.json"
grep -q 'ART EDITION 03' "$new/game/index.html"
service_user=$(systemctl show -p User --value showcase)
runuser -u "${service_user:-root}" -- test -r "$new/game/index.html"
diff -qr --exclude=game "$old" "$new" >/dev/null
test "$(readlink -f "$current")" = "$old" || { echo 'Another deployment changed the root; refused to overwrite it.' >&2; exit 1; }
ln -s "$new" "$current.next-game-$release"
mv -Tf "$current.next-game-$release" "$current"
rollback() {
  ln -s "$old" "$current.rollback-$release"
  mv -Tf "$current.rollback-$release" "$current"
  echo "Health check failed; restored $old" >&2
}
if ! curl -fsS --max-time 8 http://127.0.0.1:8787/_auth/api/me >/dev/null; then rollback; exit 1; fi
status=$(curl -sS --max-time 8 -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/game/)
if [ "$status" != 303 ]; then rollback; echo "Expected unchanged login redirect, got $status" >&2; exit 1; fi
printf 'Release: %s\nPrevious: %s\nGame: https://121.37.174.248/game/\nAnonymous HTTP: %s\n' "$new" "$old" "$status"
cat "$new/game/release.json"
REMOTE
