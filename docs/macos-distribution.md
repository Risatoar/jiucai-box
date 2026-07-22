# macOS 正式分发配置

`npm run package:mac` 只生成可向普通用户分发的正式安装包。构建过程会强制检查 Developer ID 签名、Apple 公证、票据和 DMG 完整性，任一环节不通过都会停止。

## 一次性准备

1. 加入 Apple Developer Program。
2. 在 Apple Developer 后台创建 `Developer ID Application` 证书。
3. 把证书及其私钥导入构建 Mac 的“登录”钥匙串。
4. 确认本机可以识别证书：

```bash
security find-identity -v -p codesigning
```

输出中必须出现 `Developer ID Application`。

## 配置公证凭据

推荐把公证密码保存到钥匙串，不要提交到 Git：

```bash
xcrun notarytool store-credentials "jiucai-box-notary" \
  --apple-id "你的 Apple ID" \
  --team-id "你的 Team ID" \
  --password "App 专用密码"
```

打包前设置钥匙串配置名：

```bash
export APPLE_KEYCHAIN_PROFILE="jiucai-box-notary"
nvm use 20
npm run package:mac
```

也可以通过下列环境变量提供凭据：

- `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`
- `APPLE_API_KEY`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`

不要把密码、私钥或 `.p8` 内容写入 `package.json`、`.env` 示例或提交到仓库。

## 内部未签名包

```bash
npm run package:mac:internal
```

该命令仅供本机开发验证。生成的包没有 Developer ID 签名和 Apple 公证，通过飞书、网盘或浏览器传给其他用户后会被 Gatekeeper 拦截，不能用于正式分发。
