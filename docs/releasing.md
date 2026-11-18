# 发布流程（维护者） —— dsh-persona-modes

> 面向维护者；用户文档见 [README.md](../README.md)。

CI（`.github/workflows/ci.yml`）在 `ubuntu-latest` 与 `windows-latest` 上跑 Node 20 / 22 / 24，
每条腿两步：`npm test`（离线测试）+ `npm pack --dry-run` 校验 tarball 里确实带上宿主半、客户端半、
`src/`、`cordis.patch.yml`、`locale/`、`icon.svg`、README 与 LICENSE —— 少一个文件，用户装完就是
「装了但设置页不出现」，比测试红更难排查。真实宿主里的开关验证不在 CI：它要在隔离 profile 里启动
桌面宿主，托管 runner 没有交互式桌面会话。

发版在本机完成，不走 CI：npm 可信发布（Trusted Publishing / OIDC）在本仓库一直返回 404，
CI 发布已于 2026-11-12 取消，`release.yml` 已移除。每次发版：

```powershell
# 本机 npm 默认 registry 是镜像源，登录与发布都要显式指官方源
npm login --registry=https://registry.npmjs.org/
npm version patch --no-git-tag-version
git commit -am "chore(release): 0.3.2"
git tag v0.3.2
git push origin master --tags
npm test
npm publish --registry=https://registry.npmjs.org/
gh release create v0.3.2 --generate-notes --title v0.3.2
```
