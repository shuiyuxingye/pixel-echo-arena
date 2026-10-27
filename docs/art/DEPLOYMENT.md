# 发布与回退

游戏入口：<https://121.37.174.248/game/>，无需登录。按用户 2026-10-27 的要求，展示网关仅将 `game` 加入公开项目名单；其他项目与管理接口仍保留原有登录和权限检查。

## 更新

```bash
npm run build:share
python3 tools/docs/package_delivery.py
# 检查后提交本项目源文件与产物，再生成公开快照。
python3 tools/release/publish_snapshot.py
git push origin github-main:main
bash tools/release/deploy-game.sh
```

部署使用本机既有SSH别名`huawei-cloud`，不在仓库保存连接密钥。脚本先上传候选文件，复制现有静态版本，仅替换`game/`中的游戏、软件许可与版本说明，再原子切换`/srv/shuiyu/current`。其他项目内容原样保留，showcase/Caddy不需要重启；数据库、会话和权限配置不动。

发布前若另一个部署已改动当前静态根，脚本拒绝覆盖。网关健康或游戏匿名访问 HTTP 200 检查失败时，脚本恢复旧静态根。

## 检查与回退

- 版本：直接查看`/game/release.json`；包含公开Git提交和版本目录。
- 匿名访问`/game/`应返回 HTTP 200；`/game` 自动补斜杠。主页仍可公开访问，其他受保护项目仍须登录。
- 脚本输出`Previous:`，保留这一路径。需要回退时，在服务器上创建指向该旧目录的新软链接，再用`mv -Tf`替换`/srv/shuiyu/current`，不覆盖版本文件或删除新版本。
- 美术版未补跑用户跳过的人工18波与性能/泄漏压力检测。发布检查是文件、实际画面、游戏入口和认证边界检查，不是性能承诺。

## 存档位置

游戏数据保存在当前浏览器、当前网站来源的 `localStorage`：进行中进度为 `pixel-echo.v2.run`，最近 10 局成绩为 `pixel-echo.v2.results`，设置与键位为 `pixel-echo.v2.settings`。不保存到服务器，也不随展示站账号同步。

同一浏览器使用同一网址可以续局；换设备、换浏览器、清除网站数据或隐私窗口结束后，不能依赖原存档。只取消登录而不改网址不会改变存档位置。
