# 把「同词相遇」部署到 Render 免费版

部署完成后，你会得到 Render 分配的公开网址。朋友打开网址即可使用，不需要登录 ChatGPT。

你需要一个 GitHub 账号和一个 Render 账号。账号和发布操作由开发者完成，朋友只需要浏览器。

## 1. 下载并解压项目

解压 `同词相遇-Render部署包.zip`，进入里面的 `tongci-render` 文件夹。这里应直接看到：

```text
package.json
package-lock.json
render.yaml
.node-version
index.html
src/
server/
lib/
public/
tests/
dist/
```

这些文件一起组成完整游戏。Render 会同时运行网页和联机服务。

## 2. 上传到 GitHub

1. 打开 [GitHub 新建仓库](https://github.com/new)。
2. 仓库名称可填写 `tongci-meet-render`，根据需要选择 Public 或 Private，创建空仓库。
3. 在空仓库中选择上传现有文件；若已有仓库界面，选择 **Add file → Upload files**。
4. 把 `tongci-render` 文件夹**里面的文件和子文件夹**上传到仓库根目录，然后保存提交。
5. 上传完成后，仓库首页应直接能看到 `package.json`、`render.yaml`、`src` 和 `server`。如果它们都在另一个 `tongci-render` 子文件夹里，请把 Render 的 Root Directory 填为 `tongci-render`。

压缩包附带的 `dist/` 是已构建网页，也可以一并上传。Render 会按源码重新构建。

## 3. 在 Render 创建服务

1. 打开 [Render 控制台](https://dashboard.render.com/)，注册或登录。
2. 点击 **New → Web Service**。
3. 连接 GitHub，授权访问刚刚的游戏仓库，然后选择该仓库。
4. 填写下面的配置。

| 配置项 | 填写内容 |
| --- | --- |
| Name | `tongci-meet`，或你喜欢的名称 |
| Language / Runtime | `Node` |
| Branch | 选择刚才上传文件的分支，通常为 `main` |
| Region | `Singapore`（如当前可选） |
| Root Directory | 文件在仓库根目录时留空 |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm start` |
| Instance Type / Plan | **Free** |

在环境变量中设置：

| Key | Value |
| --- | --- |
| `NODE_VERSION` | `24.22.1` |
| `NODE_ENV` | `production` |

高级设置里的 Health Check Path 可填写 `/healthz`。端口由 Render 自动提供，无需手动设置。这个项目不需要填写 OpenAI API Key。

## 4. 发布并获取网址

确认选择 **Free** 后，点击创建 / 部署按钮。等待 Render 完成依赖安装、网页构建和服务启动。

服务显示 **Live** 后，复制页面提供的、以 `.onrender.com` 结尾的网址。这个才是新游戏入口；原来的 `chatgpt.site` 入口不会自动变成新地址。

如果使用 Blueprint 部署，也可以选择 **New → Blueprint** 并连接同一仓库。项目中的 `render.yaml` 已包含 Node 版本、构建命令、启动命令、健康检查和 Free 计划；确认资源预览仍为 Free 后再创建。

## 5. 和朋友验证

1. 你打开 Render 的实际游戏网址，选择 2、3 或 4 人并创建房间。
2. 点击“复制邀请链接”，发给朋友。
3. 朋友使用自己的浏览器打开邀请链接并加入，人数到齐自动开始。
4. 确认全场都确认后才显示答案。3／4 人房可安排两人输入相同词语，其他人输入不同词语，验证同词玩家自动合队。
5. 全员点击准备下一轮，验证队友能看到彼此填写，其他队伍看不到；队内全员确认后会随机选出团队答案。
6. 全场输入相同词语，确认出现结算页面；点击“保存默契记录”保存多人结果图片。
7. 全员点击“再相遇一次”，确认新一局恢复独立作答。

旧网址创建的房间不会迁移到新网址；请在新网址重新开房。

## 常见情况

### 打开时先出现 Render 的加载页面

Free Web Service 连续 15 分钟没有流量会休眠，再次访问唤醒通常约需一分钟。等待服务启动后再创建房间。

### 之前的房间找不到了

免费版房间使用内存临时保存。服务休眠、重启或重新部署后，重新创建房间即可。这个版本没有永久战绩库。

### 构建时报找不到 package.json

检查 GitHub 仓库中文件所在位置。`package.json` 在仓库根目录时，Root Directory 留空；在子文件夹时，填写那个子文件夹路径。

### 页面有了，但创建房间失败

检查创建的服务类型是否为 **Web Service**，启动命令是否为 `npm start`。联机服务需要运行 Node.js 后台。

在游戏网址后加 `/healthz`，应能看到 `{"ok":true}`。如果失败，打开 Render 的 Logs 查看启动错误。

### Render 网址在某个网络仍无法访问

先让你和朋友分别用各自的常用网络测试。更换托管平台可以移除当前 `chatgpt.site` 入口，但不能保证每个网络都能访问新平台。

## 官方参考

- [部署 Node.js 应用](https://render.com/docs/deploy-node-express-app)
- [免费服务的限制](https://render.com/docs/free)
- [设置 Node.js 版本](https://render.com/docs/node-version)
- [render.yaml 配置参考](https://render.com/docs/blueprint-spec)
