# 发布与回退

游戏沿用个人展示站的受保护入口：<https://121.37.174.248/game/>。使用原有账号登录；不会改成匿名公开，也不改账号、网关、fish或其他项目。

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

发布前若另一个部署已改动当前静态根，脚本拒绝覆盖。网关健康或匿名访问的登录跳转检查失败时，脚本恢复旧静态根。

## 检查与回退

- 版本：登录后查看`/game/release.json`；包含公开Git提交和版本目录。
- 匿名访问`/game/`应继续跳转登录；主页仍可公开访问。
- 脚本输出`Previous:`，保留这一路径。需要回退时，在服务器上创建指向该旧目录的新软链接，再用`mv -Tf`替换`/srv/shuiyu/current`，不覆盖版本文件或删除新版本。
- 美术版未补跑用户跳过的人工18波与性能/泄漏压力检测。发布检查是文件、实际画面、游戏入口和认证边界检查，不是性能承诺。
