#!/usr/bin/env bash
# Deploy only this game's inline build; /game/ is public, other showcase ACLs stay unchanged.
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
# Validate the staged metadata before it can reach the server.
python3 - "$STAGE/release.json" "$PUBLIC_COMMIT" "$RELEASE" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
assert d['publicCommit']==sys.argv[2] and d['release']==sys.argv[3]
print('Staged release.json is valid JSON:', d['release'])
PY
EXPECTED_SHA="$(shasum -a 256 "$STAGE/index.html" | awk '{print $1}')"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=12 -o ServerAliveInterval=10 -o ServerAliveCountMax=3)
ssh "${SSH_OPTS[@]}" "$HOST" "mkdir -p '/srv/shuiyu/incoming/$RELEASE'"
scp -q "${SSH_OPTS[@]}" "$STAGE/index.html" "$STAGE/THIRD_PARTY_NOTICES.txt" "$STAGE/release.json" "$HOST:/srv/shuiyu/incoming/$RELEASE/"
ssh "${SSH_OPTS[@]}" "$HOST" bash -s -- "$RELEASE" "$EXPECTED_SHA" "$PUBLIC_COMMIT" <<'REMOTE'
set -euo pipefail
release="$1"
expected_sha="$2"
public_commit="$3"
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
python3 -c 'import json,sys; d=json.load(open(sys.argv[1],encoding="utf-8")); assert d["publicCommit"]==sys.argv[2] and d["release"]==sys.argv[3]' "$new/game/release.json" "$public_commit" "$release"
if command -v sha256sum >/dev/null 2>&1; then actual_sha=$(sha256sum "$new/game/index.html"); else actual_sha=$(shasum -a 256 "$new/game/index.html"); fi
test "${actual_sha%% *}" = "$expected_sha"
service_user=$(systemctl show -p User --value showcase)
for f in index.html THIRD_PARTY_NOTICES.txt release.json; do
  runuser -u "${service_user:-root}" -- test -r "$new/game/$f"
done
diff -qr --exclude=game "$old" "$new" >/dev/null
rollback() {
  rm -f "$current.rollback-$release"
  ln -s "$old" "$current.rollback-$release"
  mv -Tf "$current.rollback-$release" "$current"
  echo "Health check failed; restored $old" >&2
}
rm -f "$current.next-game-$release"
ln -s "$new" "$current.next-game-$release"
if [ "$(readlink -f "$current")" != "$old" ]; then
  rm -f "$current.next-game-$release"
  echo 'Another deployment changed the root; refused to overwrite it.' >&2
  exit 1
fi
mv -Tf "$current.next-game-$release" "$current"
if [ "$(readlink -f "$current")" != "$new" ]; then
  rollback
  echo 'Static root did not switch to the new release.' >&2
  exit 1
fi
if ! curl -fsS --max-time 8 http://127.0.0.1:8787/_auth/api/me >/dev/null; then
  rollback; echo 'Auth health check failed.' >&2; exit 1
fi
if ! status=$(curl -sS --max-time 8 -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/game/); then
  rollback; echo 'Public game check could not complete.' >&2; exit 1
fi
if [ "$status" != 200 ]; then
  rollback; echo "Expected public game HTTP 200, got $status" >&2; exit 1
fi
if ! home=$(curl -sS --max-time 8 -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/); then
  rollback; echo 'Homepage check could not complete.' >&2; exit 1
fi
if [ "$home" != 200 ]; then
  rollback; echo "Expected homepage 200, got $home" >&2; exit 1
fi
for unit in caddy fish-workspace shuiyu-learning; do
  if ! systemctl is-active --quiet "$unit"; then
    rollback; echo "Unrelated service changed state: $unit" >&2; exit 1
  fi
done
printf 'Release: %s\nPrevious: %s\nGame: https://121.37.174.248/game/\nAnonymous HTTP: %s\nHomepage HTTP: %s\n' "$new" "$old" "$status" "$home"
cat "$new/game/release.json"
REMOTE
