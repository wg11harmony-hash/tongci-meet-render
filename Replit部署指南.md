# 用 Replit 发布同词相遇

现有代码可复用。项目仓库：

https://github.com/wg11harmony-hash/tongci-meet-render

## 导入

打开官方支持的快捷导入地址，登录你的 Replit 账号并按页面提示导入：

https://replit.com/github.com/wg11harmony-hash/tongci-meet-render

也可以打开 https://replit.com/import，选择 GitHub 并粘贴仓库地址。

## 运行

仓库里的 `.replit` 已设置入口、构建、启动命令和 3000 端口。Node.js 版本需符合 `package.json`（当前是 24.22.1 或更高的 24.x）。导入时核对运行环境，安装依赖后点击 Run 进行预览。

如需手动设置：

| 项目 | 内容 |
| --- | --- |
| Build | `npm ci --include=dev && npm run build` |
| Run | `npm start` |
| 内部端口 | `3000`；服务监听 `0.0.0.0` |

## 发布

打开 Publishing，选择可运行 Node.js 后台的 Autoscale，Sharing 选 Public。将 Max machines 设为 **1**，再检查账户中的额度和预估费用后发布。

当前房间存在单个进程内存里。多实例会分散两个人的房间状态，因此该版本必须使用单实例。休眠、重启和重新部署后房间可能消失；重新开房即可。需要多实例或永久保存时，再接共享数据库。

朋友使用发布后的公开网址加入房间，不需要 ChatGPT 登录。发布后先用你和朋友各自的网络测试一次“创建房间 → 邀请 → 双方提交 → 揭晓”。

本次仅准备了代码和配置，没有在你的 Replit 账号创建或发布项目。

## 官方参考

- 导入：https://docs.replit.com/build/import-from-providers
- 配置：https://docs.replit.com/features/project-setup/configuration
- 实例：https://docs.replit.com/features/publishing/machine-configuration
- 公开访问：https://docs.replit.com/features/publishing/private-deployments
